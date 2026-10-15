import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrator } from "./agents/migrator.js";
import type { VerifierFeedback } from "./agents/migrator.js";
import { runPlanner } from "./agents/planner.js";
import { riskBreakdown, runScout } from "./agents/scout.js";
import { planProbes, runVerifierJudge, runVerifierSide } from "./agents/verifier.js";
import type { Side } from "./agents/verifier.js";
import { writeCapsule } from "./capsule/writer.js";
import type { CapsuleOutput } from "./capsule/writer.js";
import { loadConfig } from "./config.js";
import { ClaimBook } from "./evidence/claims.js";
import { GroqClient } from "./llm/client.js";
import type { LlmClient } from "./llm/client.js";
import { recommendDependency } from "./recommend.js";
import { createRun, hasJson, loadRun, logEvent, readJson, setStage } from "./run/context.js";
import type { RunContext } from "./run/context.js";
import { createSandbox } from "./sandbox/sandbox.js";
import { Findings, MigrationPlan, MigrationResult, Verification } from "./schema/stages.js";
import { isGitRepo, remoteSlug } from "./tools/git.js";
import { z } from "zod";

/**
 * One agent per invocation, resuming from the run directory. The CI runner calls these from separate jobs so each
 * agent appears as its own box, hands its outputs to the next job, and Minos runs both sandboxes in parallel.
 */

const Feedback = z.object({
  reasons: z.array(z.string()),
  failingTests: z.array(z.string()),
  logTails: z.array(z.object({ logPath: z.string(), tail: z.string() })),
});

/** Appends Markdown to the job summary when running in GitHub Actions; prints it otherwise. */
export function writeSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown.trim()}\n\n`);
  else process.stderr.write(`${markdown.trim()}\n`);
}

/** Writes `name=value` to the step outputs when running in GitHub Actions. */
export function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
}

function open(runDir: string): RunContext {
  const dir = resolve(runDir);
  if (!existsSync(resolve(dir, "state.json"))) throw new Error(`${dir} is not a Themis run directory`);
  return loadRun(dir, loadConfig(dir));
}

function model(ctx: RunContext): LlmClient {
  return new GroqClient(ctx.config);
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Argus. Creates the run directory. */
export async function stageScout(repoPath: string, dependency?: string): Promise<RunContext> {
  const root = resolve(repoPath);
  if (!(await isGitRepo(root))) throw new Error(`${root} is not a git repository`);
  const config = loadConfig(root);
  const ctx = createRun({
    repoPath: root,
    repository: (await remoteSlug(root)) ?? undefined,
    mode: "run",
    dependency,
    config,
  });
  setStage(ctx, "scout", "running");
  const findings = await runScout(ctx, config.groqApiKey ? new GroqClient(config) : undefined);
  setStage(ctx, "scout", "done", { output: "findings.json" });
  const rec = recommendDependency(findings);
  setOutput("run_dir", ctx.runDir);
  setOutput("recommended", rec?.name ?? "");
  writeSummary(
    [
      "## Argus · Scout",
      `Scanned \`${ctx.state.repository}\` at \`${findings.baseRef}\` (${findings.baseCommit.slice(0, 7)}): ${findings.toolchain.language}, ${findings.toolchain.packageManager}, tests: ${findings.toolchain.testCommand ?? "none"}.`,
      "",
      "| # | Dependency | Installed | Score | Signals | Used in |",
      "|---:|---|---|---:|---|---:|",
      ...findings.dependencies.slice(0, 10).map((d, i) => {
        const signals = riskBreakdown(d.risk, d.currentVersion)
          .filter((c) => c.points > 0)
          .map((c) => `${c.signal.toLowerCase()} ${c.value}`)
          .join("; ");
        return `| ${i + 1} | \`${d.name}\`${d.dev ? " (dev)" : ""} | ${d.currentVersion} | ${d.score} | ${cell(signals || "none")} | ${d.importingFiles ?? "–"} |`;
      }),
      "",
      dependency
        ? `Requested: \`${dependency}\`.`
        : rec
          ? `Recommended for migration: \`${rec.name}\` (most risk per affected file).`
          : "No dependency to recommend.",
    ].join("\n"),
  );
  return ctx;
}

/** Athena. */
export async function stagePlan(runDir: string): Promise<MigrationPlan> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const dependency = ctx.state.dependency || recommendDependency(findings)?.name;
  if (!dependency) throw new Error("no dependency to plan");
  ctx.state.dependency = dependency;
  setStage(ctx, "planner", "running");
  const { plan } = await runPlanner(ctx, model(ctx), findings, dependency);
  setStage(ctx, "planner", "done", { output: "plan.json" });
  setOutput("feasible", String(plan.feasible));
  setOutput("dependency", dependency);
  writeSummary(
    [
      "## Athena · Planner",
      `**${plan.strategy === "replace" ? "Replace" : "Upgrade"}** \`${plan.dependency}\` ${plan.fromVersion} → \`${plan.target.name}\` ${plan.target.version} · confidence **${plan.confidence}** · feasible **${plan.feasible ? "yes" : "no"}**`,
      "",
      plan.rationale,
      "",
      `Usage sites: ${plan.usage.length}. Concerns, committed in this order:`,
      "",
      ...plan.concerns.map(
        (c, i) =>
          `${i + 1}. \`${c.kind}\` ${c.title}${c.files.length ? ` (${c.files.slice(0, 5).join(", ")}${c.files.length > 5 ? ", …" : ""})` : ""}`,
      ),
      plan.behavioralDifferences.length
        ? `\nBehavioural differences:\n${plan.behavioralDifferences.map((d) => `- ${d}`).join("\n")}`
        : "",
    ].join("\n"),
  );
  return plan;
}

/** Hephaestus. First attempt, or a retry when the last verdict was a veto. */
export async function stageMigrate(runDir: string): Promise<MigrationResult> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  const last = hasJson(ctx, "verification.json")
    ? readJson(ctx, "verification.json", Verification)
    : undefined;
  const previous =
    last && hasJson(ctx, "migration.json") ? readJson(ctx, "migration.json", MigrationResult) : undefined;
  const attempt = last && !last.passed ? last.attempt + 1 : 0;
  const feedback: VerifierFeedback | undefined =
    attempt > 0 && hasJson(ctx, "feedback.json") ? readJson(ctx, "feedback.json", Feedback) : undefined;
  ctx.state.attempt = attempt;
  const llm = model(ctx);
  const sandbox = await createSandbox(ctx, findings.toolchain.nodeVersion);
  setStage(ctx, "migrator", "running");
  try {
    const migration = await runMigrator(ctx, llm, { findings, plan, sandbox, attempt, previous, feedback });
    await planProbes(ctx, llm, { findings, plan, migration, sandbox, attempt });
    setStage(ctx, "migrator", "done", { output: "migration.json" });
    setOutput("attempt", String(attempt));
    setOutput("branch", migration.branch);
    writeSummary(
      [
        `## Hephaestus · Migrator${attempt > 0 ? ` (retry ${attempt})` : ""}`,
        `Branch \`${migration.branch}\` from ${migration.baseCommit.slice(0, 7)}. Never the default branch.`,
        attempt > 0 && feedback
          ? `\nAddressing the verdict:\n${feedback.reasons.map((r) => `- ${r}`).join("\n")}\n`
          : "",
        "| Commit | Change |",
        "|---|---|",
        ...migration.commits.map((c) => `| \`${c.sha.slice(0, 7)}\` | ${cell(c.message)} |`),
        "",
        `Characterization tests kept: ${migration.keptTests.length}${migration.keptTests.length ? ` (${migration.keptTests.join(", ")})` : ""}. Discarded (failed on the base commit): ${migration.discardedTests.length}.`,
      ].join("\n"),
    );
    return migration;
  } finally {
    await sandbox.cleanup(ctx).catch(() => undefined);
  }
}

/** Minos, one sandbox. Baseline and candidate run in parallel jobs. */
export async function stageVerifySide(runDir: string, side: Side): Promise<void> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  const migration = readJson(ctx, "migration.json", MigrationResult);
  const sandbox = await createSandbox(ctx, findings.toolchain.nodeVersion);
  const input = { findings, plan, migration, sandbox, attempt: migration.attempt };
  try {
    const probes = await planProbes(ctx, undefined, input);
    const report = await runVerifierSide(ctx, input, side, probes);
    const r = report.result;
    writeSummary(
      [
        `## Minos · ${side === "baseline" ? "Baseline" : "Candidate"} sandbox`,
        `\`${r.ref}\` @ ${r.commit.slice(0, 7)} built in Docker; tests, lint and scans ran with no network.`,
        "",
        "| Check | Result | Log |",
        "|---|---|---|",
        `| Install | exit ${r.install.exitCode} | \`${r.install.logPath}\` |`,
        `| Tests | ${r.tests ? `${r.tests.passed} passed, ${r.tests.failed} failed` : "not run"} | ${r.tests ? `\`${r.tests.logPath}\`` : ""} |`,
        `| Lint | ${r.lint ? `${r.lint.violations} violation(s)` : "not run"} | ${r.lint ? `\`${r.lint.logPath}\`` : ""} |`,
        `| Security | ${r.security ? `${r.security.findings} finding(s)` : "not run"} | ${r.security ? `\`${r.security.logPath}\`` : ""} |`,
        `| Probes | ${r.probes.length ? `${r.probes.length} sent` : "not run"} | ${r.probeLogPath ? `\`${r.probeLogPath}\`` : ""} |`,
      ].join("\n"),
    );
  } finally {
    await sandbox.cleanup(ctx).catch(() => undefined);
  }
}

/** Minos, verdict. Sets `passed` and `retry` outputs for the workflow. */
export async function stageJudge(runDir: string): Promise<Verification> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  const migration = readJson(ctx, "migration.json", MigrationResult);
  // The sides ran in Docker unless the host fallback was used, which only happens outside CI.
  const isolated = process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true";
  setStage(ctx, "verifier", "running");
  const { verification } = await runVerifierJudge(ctx, {
    findings,
    plan,
    migration,
    isolated,
    attempt: migration.attempt,
  });
  setStage(ctx, "verifier", "done", { output: "verification.json" });
  const retry = !verification.passed && verification.attempt < ctx.config.retryCap;
  setOutput("passed", String(verification.passed));
  setOutput("retry", String(retry));
  const v = verification;
  writeSummary(
    [
      `## Minos · Verdict: ${v.passed ? "passed" : "veto"}`,
      "| Delta | Value |",
      "|---|---|",
      `| New test failures | ${v.delta.newFailures.length} |`,
      `| Fixed failures | ${v.delta.fixedFailures.length} |`,
      `| Lint delta | ${v.delta.lintDelta} |`,
      `| New vulnerabilities | ${v.delta.newSecurityIds.length} |`,
      `| Resolved vulnerabilities | ${v.delta.resolvedSecurityIds.length} |`,
      `| Probe mismatches | ${v.delta.probeMismatches.length} |`,
      `| Call-site coverage | ${v.coverage.covered} of ${v.coverage.total} |`,
      v.vetoReasons.length ? `\n**Veto reasons**\n${v.vetoReasons.map((r) => `- ${r}`).join("\n")}` : "",
      !v.passed
        ? retry
          ? "\nHanding back to Hephaestus for a retry."
          : "\nRetry cap reached; recording unresolved items."
        : "",
    ].join("\n"),
  );
  return verification;
}

/** Clio. Always runs, including after failures, and records retry-cap and stage errors. */
export async function stageCapsule(runDir: string, error?: string): Promise<CapsuleOutput> {
  const ctx = open(runDir);
  const read = <T extends z.ZodType>(name: string, schema: T) =>
    hasJson(ctx, name) ? readJson(ctx, name, schema) : undefined;
  const findings = read("findings.json", Findings);
  const plan = read("plan.json", MigrationPlan);
  const migration = read("migration.json", MigrationResult);
  const verification = read("verification.json", Verification);
  const hermes = new ClaimBook("hermes");
  if (verification && !verification.passed)
    for (const r of verification.vetoReasons)
      hermes.unverified(
        "unresolved",
        `Still failing after ${verification.attempt + 1} attempt(s): ${r}`,
        "retry cap reached",
      );
  if (error) hermes.unverified("unresolved", `Run stopped early: ${error}`, "stage error");
  setStage(ctx, "capsule", "running");
  const out = await writeCapsule(ctx, {
    findings,
    plan,
    migration,
    verification,
    extraClaims: hermes.claims,
    dependency: ctx.state.dependency,
  });
  setStage(ctx, "capsule", "done", { output: "capsule.json" });
  logEvent(ctx, `clio: ${out.capsule.verdict}`);
  setOutput("verdict", out.capsule.verdict);
  setOutput("branch", out.capsule.branch ?? "");
  writeSummary(
    [
      `## Clio · Capsule: ${out.capsule.verdict}`,
      `Confidence ${out.capsule.confidence}. ${out.capsule.claims.length} claims; ${out.capsule.downgraded.length} downgraded by the evidence gate.`,
      "",
      "| Tag | Claims |",
      "|---|---:|",
      ...(["OBSERVED", "EXECUTED", "AI-RECOMMENDED", "UNVERIFIED"] as const).map(
        (tag) => `| ${tag} | ${out.capsule.claims.filter((c) => c.tag === tag).length} |`,
      ),
      "",
      "<details><summary>Capsule</summary>\n",
      out.capsuleMd.slice(0, 60_000),
      "\n</details>",
    ].join("\n"),
  );
  return out;
}
