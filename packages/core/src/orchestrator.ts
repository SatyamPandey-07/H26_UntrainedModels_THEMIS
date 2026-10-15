import { join } from "node:path";
import { sendAlert } from "./alerts.js";
import { runMigrator } from "./agents/migrator.js";
import type { VerifierFeedback } from "./agents/migrator.js";
import { runPlanner } from "./agents/planner.js";
import { runScout } from "./agents/scout.js";
import { runVerifier } from "./agents/verifier.js";
import { writeCapsule } from "./capsule/writer.js";
import type { CapsuleOutput } from "./capsule/writer.js";
import { loadConfig } from "./config.js";
import type { ThemisConfig } from "./config.js";
import { ClaimBook } from "./evidence/claims.js";
import { GroqClient } from "./llm/client.js";
import type { LlmClient } from "./llm/client.js";
import { createRun, hasJson, loadRun, logEvent, readJson, setStage } from "./run/context.js";
import type { RunContext } from "./run/context.js";
import { createSandbox } from "./sandbox/sandbox.js";
import type { Sandbox } from "./sandbox/sandbox.js";
import type { RunMode, StageName } from "./schema/run.js";
import { Findings as FindingsSchema, MigrationPlan as PlanSchema } from "./schema/stages.js";
import type {
  DependencyFinding,
  Findings,
  MigrationPlan,
  MigrationResult,
  Verification,
} from "./schema/stages.js";
import { isGitRepo, remoteSlug, removeWorktree } from "./tools/git.js";

export interface RunOptions {
  repoPath: string;
  mode: RunMode;
  dependency?: string;
  repository?: string;
  config?: ThemisConfig;
  llm?: LlmClient;
  /** Resume an earlier run directory: completed scout/planner outputs are reused. */
  resumeRunDir?: string;
  /** Overall time budget; checked between stages. */
  timeLimitMinutes?: number;
}

export interface RunOutcome {
  ctx: RunContext;
  findings?: Findings;
  plan?: MigrationPlan;
  migration?: MigrationResult;
  verification?: Verification;
  capsule?: CapsuleOutput;
  recommended?: DependencyFinding;
  error?: string;
}

/**
 * The dependency Themis migrates when none is named: the highest-ranked runtime dependency with a known
 * vulnerability or deprecation, then the highest-ranked runtime dependency, then anything.
 */
export function recommendDependency(findings: Findings): DependencyFinding | undefined {
  const deps = findings.dependencies;
  const risky = (d: DependencyFinding) => d.risk.vulnerabilities.length > 0 || d.risk.deprecated;
  return deps.find((d) => !d.dev && risky(d)) ?? deps.find(risky) ?? deps.find((d) => !d.dev) ?? deps[0];
}

async function stage<T>(ctx: RunContext, name: StageName, output: string, fn: () => Promise<T>): Promise<T> {
  setStage(ctx, name, "running");
  try {
    const result = await fn();
    setStage(ctx, name, "done", { output });
    return result;
  } catch (err) {
    setStage(ctx, name, "failed", { error: (err as Error).message });
    throw err;
  }
}

/**
 * Hermes: sequences Scout → Planner → Migrator ⇄ Verifier → Clio. The capsule stage always runs in `run` mode,
 * including after a failure, and the base branch is never written to.
 */
export async function runThemis(opts: RunOptions): Promise<RunOutcome> {
  const config = opts.config ?? loadConfig(opts.repoPath);
  if (!(await isGitRepo(opts.repoPath))) throw new Error(`${opts.repoPath} is not a git repository`);
  const repository = opts.repository ?? (await remoteSlug(opts.repoPath)) ?? undefined;
  const ctx = opts.resumeRunDir
    ? loadRun(opts.resumeRunDir, config)
    : createRun({
        repoPath: opts.repoPath,
        repository,
        mode: opts.mode,
        dependency: opts.dependency,
        config,
      });
  // Scans work without a model (no rationales); planning and migration need one.
  const llm = opts.llm ?? (config.groqApiKey ? new GroqClient(config) : undefined);
  if (!llm && opts.mode !== "scan") new GroqClient(config); // throws the actionable missing-key error
  const hermes = new ClaimBook("hermes");
  const deadline = Date.now() + (opts.timeLimitMinutes ?? 90) * 60_000;
  const checkTime = (next: string) => {
    if (Date.now() > deadline) throw new Error(`time limit reached before ${next}`);
  };
  const outcome: RunOutcome = { ctx };
  let sandbox: Sandbox | undefined;

  try {
    // 1. Scout
    outcome.findings = hasJson(ctx, "findings.json")
      ? readJson(ctx, "findings.json", FindingsSchema)
      : await stage(ctx, "scout", "findings.json", () => runScout(ctx, llm));
    outcome.recommended = recommendDependency(outcome.findings);
    if (opts.mode === "scan") return outcome;

    // 2. Planner
    checkTime("planning");
    const dependency = opts.dependency ?? ctx.state.dependency ?? outcome.recommended?.name;
    if (!dependency) throw new Error("no dependency to migrate");
    ctx.state.dependency = dependency;
    outcome.plan = hasJson(ctx, "plan.json")
      ? readJson(ctx, "plan.json", PlanSchema)
      : (
          await stage(ctx, "planner", "plan.json", () =>
            runPlanner(ctx, llm as LlmClient, outcome.findings as Findings, dependency),
          )
        ).plan;
    if (opts.mode === "plan") return outcome;

    if (!outcome.plan.feasible) {
      setStage(ctx, "migrator", "skipped");
      setStage(ctx, "verifier", "skipped");
      logEvent(ctx, "hermes: planner marked the migration infeasible; writing a Not recommended capsule");
    } else {
      // 3–4. Migrator ⇄ Verifier, retried up to the cap.
      sandbox = await createSandbox(ctx, outcome.findings.toolchain);
      let feedback: VerifierFeedback | undefined;
      for (let attempt = 0; attempt <= config.retryCap; attempt++) {
        checkTime(`migration attempt ${attempt}`);
        ctx.state.attempt = attempt;
        const findings = outcome.findings;
        const plan = outcome.plan;
        const previous = outcome.migration;
        outcome.migration = await stage(ctx, "migrator", "migration.json", () =>
          runMigrator(ctx, llm as LlmClient, {
            findings,
            plan,
            sandbox: sandbox as Sandbox,
            attempt,
            previous,
            feedback,
          }),
        );
        const migration = outcome.migration;
        checkTime(`verification attempt ${attempt}`);
        const verified = await stage(ctx, "verifier", "verification.json", () =>
          runVerifier(ctx, llm, { findings, plan, migration, sandbox: sandbox as Sandbox, attempt }),
        );
        outcome.verification = verified.verification;
        if (verified.verification.passed) break;
        feedback = verified.feedback;
        if (attempt === config.retryCap) {
          for (const reason of verified.verification.vetoReasons)
            hermes.unverified(
              "unresolved",
              `Still failing after ${attempt + 1} attempt(s): ${reason}`,
              "retry cap reached",
            );
          logEvent(ctx, `hermes: retry cap (${config.retryCap}) reached; recording unresolved items`);
        } else {
          logEvent(ctx, `hermes: verifier vetoed attempt ${attempt}; retrying with failure evidence`);
        }
      }
    }
  } catch (err) {
    outcome.error = (err as Error).message;
    hermes.unverified("unresolved", `Run stopped early: ${outcome.error}`, "stage error");
    logEvent(ctx, `hermes: error: ${outcome.error}`);
  } finally {
    if (opts.mode === "run") {
      try {
        outcome.capsule = await stage(ctx, "capsule", "capsule.json", () =>
          writeCapsule(ctx, {
            findings: outcome.findings,
            plan: outcome.plan,
            migration: outcome.migration,
            verification: outcome.verification,
            extraClaims: hermes.claims,
            dependency: ctx.state.dependency,
          }),
        );
      } catch (err) {
        outcome.error ??= `capsule failed: ${(err as Error).message}`;
      }
    }
    if (sandbox) await sandbox.cleanup(ctx).catch(() => undefined);
    if (outcome.migration)
      await removeWorktree(ctx, ctx.repoPath, outcome.migration.worktreePath).catch(() => undefined);
    ctx.state.finishedAt = new Date().toISOString();
    setStage(ctx, "capsule", ctx.state.stages.capsule?.status ?? "skipped");
  }

  if (opts.mode === "run") {
    const alert = await sendAlert(config, {
      event: outcome.capsule ? "run_completed" : "run_failed",
      repository: ctx.state.repository,
      dependency: ctx.state.dependency,
      verdict: outcome.capsule?.capsule.verdict,
      capsule_url: outcome.capsule ? join(ctx.runDir, "capsule.md") : undefined,
    });
    logEvent(ctx, `hermes: alert ${alert.sent ? "sent" : `not sent (${alert.detail})`}`);
  }
  return outcome;
}
