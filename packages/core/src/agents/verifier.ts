import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ClaimBook } from "../evidence/claims.js";
import type { LlmClient } from "../llm/client.js";
import type { RunContext } from "../run/context.js";
import { hasJson, logEvent, readJson, resolveRunPath, writeJson } from "../run/context.js";
import type { ProbeRequest, ProbeResponse, Sandbox } from "../sandbox/sandbox.js";
import type { Claim } from "../schema/claim.js";
import type {
  Findings,
  MigrationPlan,
  MigrationResult,
  SideResult,
  TestRun,
  Verification,
} from "../schema/stages.js";
import { Verification as VerificationSchema } from "../schema/stages.js";
import { countLintViolations } from "../tools/lint.js";
import { changedFiles, headCommit, trackedFiles } from "../tools/git.js";
import { opengrepAvailable, opengrepMapper } from "../tools/opengrep.js";
import { dedupeVulnerabilities } from "../tools/scanners.js";
import { ecosystemFor } from "../ecosystems/index.js";
import { tail } from "../util/misc.js";
import { runAgent } from "./base.js";
import { listFiles } from "./fs-tools.js";
import type { VerifierFeedback } from "./migrator.js";

export interface VerifierInput {
  findings: Findings;
  plan: MigrationPlan;
  migration: MigrationResult;
  sandbox: Sandbox;
  attempt: number;
}

export interface VerifierResult {
  verification: Verification;
  feedback: VerifierFeedback;
}

const ProbeChoice = z.object({
  probes: z
    .array(
      z.object({
        method: z.enum(["GET", "POST"]),
        path: z.string().startsWith("/"),
        body: z.unknown().optional(),
      }),
    )
    .max(6),
});

function readLogTail(ctx: RunContext, logPath: string, lines = 120): string {
  const abs = resolveRunPath(ctx, logPath);
  return existsSync(abs) ? tail(readFileSync(abs, "utf8"), lines) : "";
}

function normalizeBody(body: string): string {
  try {
    const sort = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sort)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, sort(x)]),
            )
          : v;
    return JSON.stringify(sort(JSON.parse(body)));
  } catch {
    return body.trim();
  }
}

export type Side = "baseline" | "candidate";

/** One side's results, written by `runVerifierSide` and read by `runVerifierJudge`. */
const SideReport = z.object({
  side: z.enum(["baseline", "candidate"]),
  result: z.custom<SideResult>(),
  passingTests: z.array(z.string()),
  scope: z.string(),
  lintLabel: z.string().optional(),
  claims: z.array(z.custom<Claim>()),
});
type SideReport = z.infer<typeof SideReport>;

interface SharedCommands {
  candidateCommit: string;
  changed: string[];
  changedSource: string[];
  testCmd?: string;
  scope: string;
  testMounts: Record<string, string>;
  lint?: { command: string; label: string };
}

/** Commands both sides run, derived only from the branch, so parallel jobs agree without talking to each other. */
async function sharedCommands(input: VerifierInput): Promise<SharedCommands> {
  const { findings, migration } = input;
  const toolchain = findings.toolchain;
  const eco = ecosystemFor(toolchain);
  const worktree = migration.worktreePath;
  const candidateCommit = await headCommit(worktree);
  const changed = await changedFiles(worktree, findings.baseCommit);
  const changedSource = changed.filter((f) => eco.sourceFile.test(f) && !migration.keptTests.includes(f));
  const full = process.env.THEMIS_FULL_TESTS === "1";
  let testCmd: string | undefined;
  if (toolchain.testRunner || toolchain.testCommand) {
    // Ecosystems without a "related tests" runner option (Python) resolve related test files themselves.
    const selected = eco.relatedTestFiles
      ? [
          ...new Set([
            ...migration.keptTests,
            ...eco.relatedTestFiles(worktree, changedSource, await trackedFiles(worktree)),
          ]),
        ]
      : migration.keptTests;
    testCmd = full
      ? eco.testCommand(toolchain, [])
      : eco.testCommand(toolchain, selected, { related: changedSource });
  }
  const lintable = changedSource.filter((f) => eco.sourceFile.test(f));
  const lintInvocation = lintable.length > 0 ? eco.lintCommand(toolchain, lintable) : undefined;
  return {
    candidateCommit,
    changed,
    changedSource,
    testCmd,
    scope: full
      ? "full test suite"
      : `tests related to ${changedSource.length} changed file(s) plus ${migration.keptTests.length} characterization test file(s)`,
    testMounts: Object.fromEntries(migration.keptTests.map((f) => [join(worktree, f), f])),
    lint: lintInvocation ? { command: lintInvocation.command, label: lintInvocation.label } : undefined,
  };
}

const sideFile = (side: Side, attempt: number) => `verify-${side}-a${attempt}.json`;
const PROBES_FILE = "probes.json";

/** Minos chooses black-box probes once per run so both sides send identical requests. */
export async function planProbes(
  ctx: RunContext,
  llm: LlmClient | undefined,
  input: VerifierInput,
): Promise<ProbeRequest[]> {
  if (hasJson(ctx, PROBES_FILE)) return readJson(ctx, PROBES_FILE, z.array(z.custom<ProbeRequest>()));
  const { findings, plan, migration } = input;
  const toolchain = findings.toolchain;
  const eco = ecosystemFor(toolchain);
  let requests: ProbeRequest[] = [];
  if (toolchain.startCommand && toolchain.port && llm && process.env.THEMIS_NO_DOCKER !== "1") {
    const routeFiles = listFiles(migration.worktreePath, ".", 3000)
      .filter((f) => /(routes?|api|server|app)\b/.test(f) && eco.sourceFile.test(f))
      .slice(0, 60);
    const choice = await runAgent(ctx, llm, {
      agent: "minos",
      label: `probes-a${input.attempt}`,
      task: "Choose up to 6 HTTP probes that reach code using the migrated dependency. Use fixed inputs. Only GET or small JSON POST.",
      data: {
        "usage-map.json": JSON.stringify(plan.usage, null, 2),
        "route-files.txt": routeFiles.join("\n"),
      },
      output: ProbeChoice,
      outputDescription: "Submit the probes.",
      maxSteps: 10,
    });
    requests = choice.output.probes as ProbeRequest[];
  }
  writeJson(ctx, PROBES_FILE, requests);
  return requests;
}

/**
 * Minos, one side: builds the commit in its own sandbox and runs the shared test, lint, security and probe
 * commands. Baseline and candidate can run in parallel jobs; `runVerifierJudge` compares them.
 */
export async function runVerifierSide(
  ctx: RunContext,
  input: VerifierInput,
  side: Side,
  probes: ProbeRequest[] = [],
): Promise<SideReport> {
  const { findings, migration, sandbox, attempt } = input;
  const toolchain = findings.toolchain;
  const eco = ecosystemFor(toolchain);
  const shared = await sharedCommands(input);
  // Separate claim and log numbering per side, so reports from parallel jobs merge without collisions.
  const book = new ClaimBook("minos", (side === "baseline" ? 100 : 200) + attempt * 1000);
  ctx.seq = Math.max(ctx.seq, (side === "baseline" ? 3000 : 6000) + attempt * 10_000);
  const commit = side === "baseline" ? findings.baseCommit : shared.candidateCommit;
  const ref = side === "baseline" ? findings.baseRef : migration.branch;
  logEvent(ctx, `minos: ${side} sandbox for ${ref} @ ${commit.slice(0, 7)}, attempt ${attempt}`);

  const prepared = await sandbox.prepare(ctx, side, commit);
  book.executed(
    "executed-results",
    `${side === "baseline" ? "Baseline" : "Candidate"} install (${ref} @ ${commit.slice(0, 7)}) exited ${prepared.install.exitCode}`,
    prepared.install,
  );
  const built = prepared.install.exitCode === 0;

  let tests: TestRun | undefined;
  let passingTests: string[] = [];
  if (built && shared.testCmd) {
    const r = await sandbox.exec(ctx, prepared, shared.testCmd, {
      label: "tests",
      mounts: side === "baseline" ? shared.testMounts : {},
      timeoutMs: 30 * 60_000,
    });
    const p = eco.parseTestOutput(r.stdout, r.exitCode);
    tests = {
      command: shared.testCmd,
      exitCode: r.exitCode,
      passed: p.passed,
      failed: p.failed,
      total: p.total,
      failingTests: p.failingTests,
      logPath: r.logPath,
    };
    passingTests = p.passingTests;
    book.executed(
      "executed-results",
      `${side === "baseline" ? "Baseline" : "Candidate"} ${shared.scope}: ${p.passed} passed, ${p.failed} failed`,
      { command: shared.testCmd, exitCode: r.exitCode, logPath: r.logPath },
    );
  }

  let lint: SideResult["lint"];
  if (built && shared.lint && (side === "candidate" || !toolchain.lintConfigProposed)) {
    const r = await sandbox.exec(ctx, prepared, shared.lint.command, {
      label: "lint",
      timeoutMs: 15 * 60_000,
    });
    lint = {
      command: shared.lint.command,
      exitCode: r.exitCode,
      violations: r.exitCode === 0 ? 0 : countLintViolations(r.stdout + r.stderr),
      logPath: r.logPath,
    };
  }

  // Security rescan of this side's tree (lockfile based; no project code executes).
  const dir = side === "baseline" ? ctx.repoPath : migration.worktreePath;
  const ids = new Set<string>();
  let first: { command: string; logPath: string; exitCode: number } | undefined;
  for (const scanner of eco.scanners) {
    const out = await scanner.scan(ctx, dir);
    if (!out.ok) continue;
    first ??= { command: out.command, logPath: out.logPath, exitCode: out.exitCode };
    for (const v of dedupeVulnerabilities(out.data)) ids.add(`${v.packageName}:${v.id}`);
  }
  const security = first
    ? {
        findings: ids.size,
        ids: [...ids].sort(),
        command: first.command,
        logPath: first.logPath,
        exitCode: first.exitCode,
      }
    : undefined;

  let probeResponses: ProbeResponse[] = [];
  let probeLogPath: string | undefined;
  if (built && probes.length > 0 && toolchain.startCommand && toolchain.port && sandbox.kind === "docker") {
    const out = await sandbox.probe(
      ctx,
      prepared,
      { command: toolchain.startCommand, port: toolchain.port },
      probes,
    );
    probeResponses = out.responses;
    probeLogPath = out.result.logPath;
  }

  const report: SideReport = {
    side,
    result: {
      ref,
      commit,
      install: { exitCode: prepared.install.exitCode, logPath: prepared.install.logPath },
      tests,
      lint,
      security,
      probes: probeResponses,
      probeLogPath,
    },
    passingTests,
    scope: shared.scope,
    lintLabel: shared.lint?.label,
    claims: book.claims,
  };
  writeJson(ctx, sideFile(side, attempt), report);
  return report;
}

/** Minos, verdict: compares the two sides, rescans usage, measures coverage and holds the veto. */
export async function runVerifierJudge(
  ctx: RunContext,
  input: Omit<VerifierInput, "sandbox"> & { isolated: boolean },
): Promise<VerifierResult> {
  const { findings, plan, migration, attempt } = input;
  const toolchain = findings.toolchain;
  const eco = ecosystemFor(toolchain);
  const worktree = migration.worktreePath;
  const book = new ClaimBook("minos", 300 + attempt * 1000);
  const base = readJson(ctx, sideFile("baseline", attempt), SideReport);
  const cand = readJson(ctx, sideFile("candidate", attempt), SideReport);
  const vetoReasons: string[] = [];
  const logTails: VerifierFeedback["logTails"] = [];
  const claims = [...base.claims, ...cand.claims];

  if (!input.isolated)
    book.unverified(
      "unresolved",
      "Verification ran on the host without the Docker sandbox: no network cut, resource limits or read-only source.",
      "Docker unavailable on this machine",
    );

  const b = base.result;
  const c = cand.result;
  if (c.install.exitCode !== 0 && b.install.exitCode === 0) {
    vetoReasons.push(
      `Candidate dependency install fails while the baseline install succeeds (see ${c.install.logPath}).`,
    );
    logTails.push({ logPath: c.install.logPath, tail: readLogTail(ctx, c.install.logPath) });
  }

  const newFailures: string[] = [];
  const fixedFailures: string[] = [];
  if (b.tests && c.tests) {
    newFailures.push(...c.tests.failingTests.filter((x) => !b.tests?.failingTests.includes(x)));
    fixedFailures.push(...b.tests.failingTests.filter((x) => !c.tests?.failingTests.includes(x)));
    if (b.tests.failed > 0)
      book.executed(
        "gaps",
        `${b.tests.failed} test(s) already fail on the baseline; they are not counted against the branch`,
        b.tests,
      );
    if (newFailures.length > 0) {
      vetoReasons.push(
        `${newFailures.length} test(s) pass on the baseline and fail on the candidate: ${newFailures.slice(0, 10).join("; ")}.`,
      );
      logTails.push({ logPath: c.tests.logPath, tail: readLogTail(ctx, c.tests.logPath) });
    }
  } else if (!toolchain.testRunner && !toolchain.testCommand) {
    book.unverified(
      "gaps",
      "The repository has no test command; behaviour was not checked by tests.",
      "no test runner detected",
    );
  } else {
    book.unverified(
      "unresolved",
      "Tests were not run on both sides because an install failed.",
      "baseline or candidate install failed",
    );
  }

  let lintDelta = 0;
  if (c.lint && b.lint) {
    lintDelta = c.lint.violations - b.lint.violations;
    book.executed(
      "executed-results",
      `${cand.lintLabel ?? "Lint"} on changed files: baseline ${b.lint.violations}, candidate ${c.lint.violations} violation(s)`,
      c.lint,
    );
    if (lintDelta > 0)
      vetoReasons.push(
        `The branch adds ${lintDelta} lint violation(s) in changed files (see ${c.lint.logPath}).`,
      );
  } else if (c.lint) {
    book.executed(
      "executed-results",
      `${cand.lintLabel ?? "Lint"} (config added by Themis) reports ${c.lint.violations} violation(s) in changed files`,
      c.lint,
    );
    book.unverified(
      "gaps",
      "The baseline had no linter, so the lint delta could not be computed.",
      "no baseline lint config",
    );
  }

  const newSecurityIds =
    b.security && c.security ? c.security.ids.filter((i) => !b.security?.ids.includes(i)) : [];
  const resolvedSecurityIds =
    b.security && c.security ? b.security.ids.filter((i) => !c.security?.ids.includes(i)) : [];
  if (b.security && c.security) {
    book.executed(
      "executed-results",
      `Security rescan: baseline ${b.security.findings}, candidate ${c.security.findings} finding(s); ${resolvedSecurityIds.length} resolved, ${newSecurityIds.length} new`,
      {
        command: "security rescan (npm audit / OSV-Scanner / Trivy or pip-audit)",
        exitCode: c.security.exitCode,
        logPath: c.security.logPath,
      },
    );
    if (newSecurityIds.length > 0)
      vetoReasons.push(`The branch introduces vulnerabilities: ${newSecurityIds.join(", ")}.`);
  } else
    book.unverified(
      "gaps",
      "Security rescan did not run on both sides (no scanner available).",
      "scanners unavailable",
    );

  // After a replacement the old package must be gone.
  if (plan.strategy === "replace") {
    const usageRule = plan.rules.find((r) => !r.hasFix);
    let remaining: string[] = [];
    if (usageRule && (await opengrepAvailable(ctx))) {
      const out = await opengrepMapper.map(
        ctx,
        worktree,
        resolveRunPath(ctx, usageRule.path),
        eco.opengrepExcludes,
      );
      if (out.ok) {
        remaining = out.data.filter((s) => s.symbol === "import").map((s) => `${s.file}:${s.line}`);
        book.executed(
          "executed-results",
          `Opengrep rescan of the branch: ${remaining.length} remaining import(s) of \`${plan.dependency}\``,
          out,
        );
      }
    } else {
      remaining = eco
        .regexUsageMap(worktree, listFiles(worktree, ".", 5000), plan.dependency)
        .filter((s) => s.symbol === "import")
        .map((s) => `${s.file}:${s.line}`);
      book.unverified(
        "executed-results",
        `Regex rescan of the branch: ${remaining.length} remaining import(s) of \`${plan.dependency}\``,
        "opengrep unavailable",
      );
    }
    if (remaining.length > 0)
      vetoReasons.push(
        `\`${plan.dependency}\` is still imported after the replacement at: ${remaining.join(", ")}.`,
      );
  }

  const probeMismatches: Verification["delta"]["probeMismatches"] = [];
  if (c.probes.length > 0) {
    for (const y of c.probes) {
      const x = b.probes.find((r) => r.path === y.path && r.method === y.method);
      if (x && (x.status !== y.status || normalizeBody(x.body) !== normalizeBody(y.body)))
        probeMismatches.push({
          path: `${y.method} ${y.path}`,
          baseline: `${x.status} ${x.body.slice(0, 500)}`,
          candidate: `${y.status} ${y.body.slice(0, 500)}`,
        });
    }
    if (c.probeLogPath)
      book.executed(
        "executed-results",
        `Black-box probes: ${c.probes.length} sent to both apps, ${probeMismatches.length} mismatch(es)`,
        { command: "themis probes", exitCode: 0, logPath: c.probeLogPath },
      );
    if (probeMismatches.length > 0)
      vetoReasons.push(
        `Black-box probes differ between baseline and candidate: ${probeMismatches.map((m) => m.path).join(", ")}.`,
      );
  } else {
    book.unverified(
      "gaps",
      "Black-box probes were not run (no start command and port detected, or no Docker sandbox).",
      "probes skipped",
    );
  }

  // Every call site of the migrated dependency is affected by the change, edited or not.
  const touched = plan.usage.filter((s) => s.symbol !== "import");
  const covered = touched.filter((s) => cand.passingTests.some((name) => name.includes(eco.siteTag(s))));
  const uncovered = touched.filter((s) => !covered.includes(s)).map((s) => `${s.file}:${s.line} ${s.symbol}`);
  const coverageText = `Call-site coverage: ${covered.length} of ${touched.length} affected call sites exercised by passing characterization tests`;
  if (c.tests) book.executed("executed-results", coverageText, c.tests);
  else book.unverified("executed-results", coverageText, "no tests ran on the candidate");
  for (const u of uncovered.slice(0, 50))
    book.unverified(
      "gaps",
      `Call site not covered by a passing test: ${u}`,
      "no characterization test names this site",
    );

  const passed = vetoReasons.length === 0;
  for (const r of vetoReasons)
    book.executed(
      "executed-results",
      `Veto: ${r}`,
      c.tests ?? { command: "install", exitCode: c.install.exitCode, logPath: c.install.logPath },
    );

  const verification: Verification = VerificationSchema.parse({
    baseline: b,
    candidate: c,
    delta: { newFailures, fixedFailures, lintDelta, newSecurityIds, resolvedSecurityIds, probeMismatches },
    coverage: { covered: covered.length, total: touched.length, uncovered },
    passed,
    vetoReasons,
    attempt,
    claims: [...claims, ...book.claims],
  });
  const feedback: VerifierFeedback = {
    reasons: vetoReasons,
    failingTests: newFailures,
    logTails: logTails.map((l) => ({ ...l, tail: l.tail.slice(-8000) })),
  };
  writeJson(ctx, `verification-attempt-${attempt}.json`, verification);
  writeJson(ctx, "verification.json", verification);
  writeJson(ctx, "feedback.json", feedback);
  logEvent(
    ctx,
    `minos: ${passed ? "passed" : `vetoed (${vetoReasons.length} reason(s))`}; coverage ${covered.length}/${touched.length}`,
  );
  return { verification, feedback };
}

/** Minos, sequential: both sides one after the other, then the verdict (used by `themis run` and the plugin). */
export async function runVerifier(
  ctx: RunContext,
  llm: LlmClient | undefined,
  input: VerifierInput,
): Promise<VerifierResult> {
  const probes = await planProbes(ctx, llm, input);
  await runVerifierSide(ctx, input, "baseline", probes);
  await runVerifierSide(ctx, input, "candidate", probes);
  return runVerifierJudge(ctx, { ...input, isolated: input.sandbox.isolated });
}
