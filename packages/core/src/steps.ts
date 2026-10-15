import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { finalizePlan, parseRules, PlanDraft, writeRules } from "./agents/planner.js";
import type { RuleFile } from "./agents/planner.js";
import { runMigrator, validateCharacterizationTests } from "./agents/migrator.js";
import { runScout } from "./agents/scout.js";
import { runVerifier } from "./agents/verifier.js";
import { writeCapsule } from "./capsule/writer.js";
import type { CapsuleOutput } from "./capsule/writer.js";
import { loadConfig } from "./config.js";
import { ClaimBook } from "./evidence/claims.js";
import type { LlmClient } from "./llm/client.js";
import { createRun, loadRun, logEvent, readJson, writeJson } from "./run/context.js";
import type { RunContext } from "./run/context.js";
import { createSandbox, HostSandbox } from "./sandbox/sandbox.js";
import { Claim } from "./schema/claim.js";
import { Findings, MigrationPlan, MigrationResult, UsageSite } from "./schema/stages.js";
import { commitFiles, dirtyFiles, isGitRepo, remoteSlug, removeWorktree, trackedFiles } from "./tools/git.js";
import { dedupeSites, opengrepAvailable, opengrepMapper } from "./tools/opengrep.js";
import { ecosystemFor } from "./ecosystems/index.js";
import { slugify } from "./util/misc.js";

/**
 * Step commands for the Claude Code plugin. Claude Code is the model: it writes rules, the plan draft, code edits
 * and characterization tests; these functions do every deterministic part and record provenance. Claims for
 * Claude's own work are AI-RECOMMENDED with the model name "claude-code".
 */
export const PLUGIN_MODEL = "claude-code";

const UsageFile = z.object({
  dependency: z.string(),
  usage: z.array(UsageSite),
  usageRulesPath: z.string(),
  claims: z.array(Claim),
});

/** A model client for code paths that must not call a model in plugin mode. */
const noModel: LlmClient = {
  model: PLUGIN_MODEL,
  chat: () =>
    Promise.reject(new Error("this step does not call a model; Claude Code performs the model work")),
};

function open(runDir: string): RunContext {
  const dir = resolve(runDir);
  return loadRun(dir, loadConfig(dir));
}

export interface MapResult {
  runDir: string;
  dependency: string;
  usage: UsageSite[];
  mapper: "opengrep" | "regex";
}

/** Scan (no model), then map every use of `pkg` with the import rule plus optional rules written by Claude. */
export async function stepMap(repoPath: string, pkgName: string, rulesFile?: string): Promise<MapResult> {
  let pkg = pkgName;
  const root = resolve(repoPath);
  if (!(await isGitRepo(root))) throw new Error(`${root} is not a git repository`);
  const ctx = createRun({
    repoPath: root,
    repository: (await remoteSlug(root)) ?? undefined,
    mode: "plan",
    dependency: pkg,
    config: loadConfig(root),
  });
  const findings = await runScout(ctx, undefined);
  const eco = ecosystemFor(findings.toolchain);
  // Python distribution names compare in normalised form (PyYAML == pyyaml); for npm this is an exact match.
  const found = findings.dependencies.find(
    (d) => d.name === pkg || eco.normalizeName(d.name) === eco.normalizeName(pkg),
  );
  if (!found) throw new Error(`${pkg} is not a direct dependency of this repository`);
  pkg = found.name;

  const book = new ClaimBook("athena");
  let rules: RuleFile = eco.importRule(pkg);
  if (rulesFile) {
    const parsed = parseRules(readFileSync(resolve(rulesFile), "utf8"), pkg, eco.ruleLanguages);
    if (parsed.error) throw new Error(`rules file rejected: ${parsed.error}`);
    rules = { rules: [...rules.rules, ...(parsed.rules?.rules ?? [])] };
  }
  const usageRulesPath = writeRules(ctx, `${slugify(pkg)}-usage.yaml`, rules);
  const files = await trackedFiles(root);
  let usage: UsageSite[];
  let mapper: MapResult["mapper"] = "regex";
  const outcome = (await opengrepAvailable(ctx))
    ? await opengrepMapper.map(ctx, root, usageRulesPath, eco.opengrepExcludes)
    : undefined;
  if (outcome?.ok) {
    mapper = "opengrep";
    usage = dedupeSites([...outcome.data]);
    book.executed("usage-locations", `Opengrep found ${usage.length} usage site(s) of \`${pkg}\``, outcome);
  } else {
    usage = eco.regexUsageMap(root, files, pkg);
    book.unverified(
      "gaps",
      outcome
        ? `Opengrep could not run the rules (${outcome.reason}); regex mapping used.`
        : "Opengrep is not installed; usage was mapped with the regex fallback.",
      "usage map produced by regex matching",
    );
  }
  for (const s of usage.slice(0, 200))
    book.observed("usage-locations", `${s.file}:${s.line} \`${s.symbol}\` (${s.ruleId})`, {
      file: s.file,
      line: s.line,
    });
  writeJson(ctx, "usage.json", { dependency: pkg, usage, usageRulesPath, claims: book.claims });
  return { runDir: ctx.runDir, dependency: pkg, usage, mapper };
}

/** Validate Claude's plan draft (target must exist on the registry) and write plan.json. */
export async function stepPlan(runDir: string, draftFile: string): Promise<MigrationPlan> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const mapped = readJson(ctx, "usage.json", UsageFile);
  const raw: unknown = JSON.parse(readFileSync(resolve(draftFile), "utf8"));
  const parsed = PlanDraft.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `plan draft rejected: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  const draft = parsed.data;
  const eco = ecosystemFor(findings.toolchain);
  const target = await eco.registryInfo(draft.target.name);
  if (!target)
    throw new Error(
      `plan draft rejected: package "${draft.target.name}" does not exist on ${eco.labels.registry}`,
    );
  if (!target.versionExists(draft.target.version))
    throw new Error(
      `plan draft rejected: ${draft.target.name}@${draft.target.version} does not exist; latest is ${target.latestVersion}`,
    );
  const dep = findings.dependencies.find((d) => d.name === mapped.dependency);
  if (!dep) throw new Error(`${mapped.dependency} is missing from findings.json`);
  const book = new ClaimBook("athena", mapped.claims.length);
  book.claims.push(...mapped.claims);
  const { plan } = finalizePlan(ctx, {
    findings,
    dep,
    usage: mapped.usage,
    files: await trackedFiles(ctx.repoPath),
    usageRules: eco.importRule(dep.name),
    usageRulesPath: resolve(ctx.runDir, mapped.usageRulesPath),
    draft,
    model: PLUGIN_MODEL,
    inputs: ["findings.json", "usage.json"],
    book,
  });
  return plan;
}

/** Create the themis/* branch in a worktree and make the deterministic commits. */
export async function stepBranch(runDir: string): Promise<MigrationResult> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  if (!plan.feasible) throw new Error("the plan is marked infeasible; write the capsule instead of a branch");
  return runMigrator(ctx, noModel, {
    findings,
    plan,
    sandbox: new HostSandbox(findings.toolchain),
    attempt: 0,
    deterministicOnly: true,
  });
}

/** Commit the files Claude edited in the worktree for one model-edit concern. */
export async function stepCommit(
  runDir: string,
  concernId: string,
  summary: string,
): Promise<MigrationResult> {
  const ctx = open(runDir);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  const migration = readJson(ctx, "migration.json", MigrationResult);
  const concern = plan.concerns.find((c) => c.id === concernId) ?? {
    id: concernId,
    kind: "model-edit" as const,
    title: summary.slice(0, 80),
    files: [],
    instructions: "",
  };
  const files = (await dirtyFiles(migration.worktreePath)).filter((f) => !f.startsWith(".themis/"));
  if (files.length === 0) throw new Error(`no changed files in ${migration.worktreePath}`);
  const message = `themis(${concern.kind}): ${concern.title}`;
  const sha = await commitFiles(ctx, migration.worktreePath, files, message);
  if (!sha) throw new Error("nothing was committed");
  const book = new ClaimBook("hephaestus", migration.claims.length);
  book.recommended("proposed-changes", `${concern.title} (${sha.slice(0, 7)}): ${summary}`, PLUGIN_MODEL, [
    "plan.json",
    ...files,
  ]);
  const updated = MigrationResult.parse({
    ...migration,
    commits: [...migration.commits, { sha, concernId: concern.id, message }],
    claims: [...migration.claims, ...book.claims],
  });
  writeJson(ctx, "migration.json", updated);
  logEvent(ctx, `hephaestus: committed ${concern.id} as ${sha.slice(0, 7)} (claude-code)`);
  return updated;
}

/** Validate Claude's characterization tests on the base commit; keep and commit only the passing ones. */
export async function stepTests(runDir: string, files: string[]): Promise<MigrationResult> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  const migration = readJson(ctx, "migration.json", MigrationResult);
  const sandbox = await createSandbox(ctx, findings.toolchain);
  const book = new ClaimBook("hephaestus", migration.claims.length);
  book.recommended(
    "suggested-tests",
    `Claude Code wrote ${files.length} characterization test file(s): ${files.join(", ")}`,
    PLUGIN_MODEL,
    ["plan.json", "usage.json"],
  );
  const commits = [...migration.commits];
  const discarded = [...migration.discardedTests];
  const concern = plan.concerns.find((c) => c.kind === "tests") ?? {
    id: "tests",
    kind: "tests" as const,
    title: "characterization tests",
  };
  try {
    const kept = await validateCharacterizationTests(ctx, {
      worktree: migration.worktreePath,
      files,
      concern,
      toolchain: findings.toolchain,
      sandbox,
      baseCommit: migration.baseCommit,
      book,
      discarded,
      commit: async (c, paths) => {
        const message = `themis(${c.kind}): ${c.title}`;
        const sha = await commitFiles(ctx, migration.worktreePath, paths, message);
        if (sha) commits.push({ sha, concernId: c.id, message });
        return sha;
      },
    });
    const updated = MigrationResult.parse({
      ...migration,
      commits,
      keptTests: [...new Set([...migration.keptTests, ...kept])],
      discardedTests: discarded,
      claims: [...migration.claims, ...book.claims],
    });
    writeJson(ctx, "migration.json", updated);
    return updated;
  } finally {
    // Each step runs in its own process, so its sandbox images are not reused later; remove them now.
    await sandbox.cleanup(ctx).catch(() => undefined);
  }
}

/** Verify the branch against the base commit and write the capsule. Removes the worktree; the branch stays. */
export async function stepVerify(runDir: string): Promise<CapsuleOutput> {
  const ctx = open(runDir);
  const findings = readJson(ctx, "findings.json", Findings);
  const plan = readJson(ctx, "plan.json", MigrationPlan);
  const migration = readJson(ctx, "migration.json", MigrationResult);
  const sandbox = await createSandbox(ctx, findings.toolchain);
  try {
    const { verification } = await runVerifier(ctx, undefined, {
      findings,
      plan,
      migration,
      sandbox,
      attempt: 0,
    });
    return await writeCapsule(ctx, { findings, plan, migration, verification, dependency: plan.dependency });
  } finally {
    await sandbox.cleanup(ctx).catch(() => undefined);
    await removeWorktree(ctx, ctx.repoPath, migration.worktreePath).catch(() => undefined);
  }
}
