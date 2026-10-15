import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ClaimBook } from "../evidence/claims.js";
import type { LlmClient } from "../llm/client.js";
import type { RunContext } from "../run/context.js";
import { logEvent, resolveRunPath, writeJson } from "../run/context.js";
import type { PreparedRef, ProbeRequest, ProbeResponse, Sandbox } from "../sandbox/sandbox.js";
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

/** Minos: builds baseline and candidate identically, runs the same checks, and judges only the delta. Holds the veto. */
export async function runVerifier(
  ctx: RunContext,
  llm: LlmClient | undefined,
  input: VerifierInput,
): Promise<VerifierResult> {
  const { findings, plan, migration, sandbox, attempt } = input;
  const book = new ClaimBook("minos");
  const toolchain = findings.toolchain;
  const eco = ecosystemFor(toolchain);
  const worktree = migration.worktreePath;
  const candidateCommit = await headCommit(worktree);
  const vetoReasons: string[] = [];
  const logTails: VerifierFeedback["logTails"] = [];
  logEvent(
    ctx,
    `minos: verifying ${migration.branch} (${candidateCommit.slice(0, 7)}) against ${findings.baseCommit.slice(0, 7)}, attempt ${attempt}`,
  );

  if (!sandbox.isolated)
    book.unverified(
      "unresolved",
      "Verification ran on the host without the Docker sandbox: no network cut, resource limits or read-only source.",
      "Docker unavailable on this machine",
    );

  // 1. Identical builds. Baseline is recorded first so pre-existing failures are never blamed on the branch.
  const baseline = await sandbox.prepare(ctx, "baseline", findings.baseCommit);
  const candidate = await sandbox.prepare(ctx, "candidate", candidateCommit);
  book.executed(
    "executed-results",
    `Baseline install (${findings.baseRef} @ ${findings.baseCommit.slice(0, 7)}) exited ${baseline.install.exitCode}`,
    baseline.install,
  );
  book.executed(
    "executed-results",
    `Candidate install (${migration.branch} @ ${candidateCommit.slice(0, 7)}) exited ${candidate.install.exitCode}`,
    candidate.install,
  );
  if (candidate.install.exitCode !== 0 && baseline.install.exitCode === 0) {
    vetoReasons.push(
      `Candidate dependency install fails while the baseline install succeeds (see ${candidate.install.logPath}).`,
    );
    logTails.push({ logPath: candidate.install.logPath, tail: readLogTail(ctx, candidate.install.logPath) });
  }
  const bothBuilt = baseline.install.exitCode === 0 && candidate.install.exitCode === 0;

  const changed = await changedFiles(worktree, findings.baseCommit);
  const changedSource = changed.filter((f) => eco.sourceFile.test(f) && !migration.keptTests.includes(f));
  const testMounts = Object.fromEntries(migration.keptTests.map((f) => [join(worktree, f), f]));

  // 2. Tests: same command on both sides; characterization tests are mounted read-only into the baseline.
  let baseTests: TestRun | undefined;
  let candTests: TestRun | undefined;
  let candPassing: string[] = [];
  const newFailures: string[] = [];
  const fixedFailures: string[] = [];
  if (bothBuilt && (toolchain.testRunner || toolchain.testCommand)) {
    const full = process.env.THEMIS_FULL_TESTS === "1";
    // Ecosystems without a "related tests" runner option (Python) resolve related test files themselves.
    const selected = eco.relatedTestFiles
      ? [
          ...new Set([
            ...migration.keptTests,
            ...eco.relatedTestFiles(worktree, changedSource, await trackedFiles(worktree)),
          ]),
        ]
      : migration.keptTests;
    const cmd = full
      ? eco.testCommand(toolchain, [])
      : eco.testCommand(toolchain, selected, { related: changedSource });
    const run = async (
      ref: PreparedRef,
      mounts: Record<string, string>,
    ): Promise<{ run: TestRun; passing: string[] }> => {
      const r = await sandbox.exec(ctx, ref, cmd, { label: "tests", mounts, timeoutMs: 30 * 60_000 });
      const p = eco.parseTestOutput(r.stdout, r.exitCode);
      return {
        run: {
          command: cmd,
          exitCode: r.exitCode,
          passed: p.passed,
          failed: p.failed,
          total: p.total,
          failingTests: p.failingTests,
          logPath: r.logPath,
        },
        passing: p.passingTests,
      };
    };
    const b = await run(baseline, testMounts);
    const c = await run(candidate, {});
    baseTests = b.run;
    candTests = c.run;
    candPassing = c.passing;
    newFailures.push(...c.run.failingTests.filter((t) => !b.run.failingTests.includes(t)));
    fixedFailures.push(...b.run.failingTests.filter((t) => !c.run.failingTests.includes(t)));
    const scope = full
      ? "full test suite"
      : `tests related to ${changedSource.length} changed file(s) plus ${migration.keptTests.length} characterization test file(s)`;
    book.executed("executed-results", `Baseline ${scope}: ${b.run.passed} passed, ${b.run.failed} failed`, {
      command: cmd,
      exitCode: b.run.exitCode,
      logPath: b.run.logPath,
    });
    book.executed("executed-results", `Candidate ${scope}: ${c.run.passed} passed, ${c.run.failed} failed`, {
      command: cmd,
      exitCode: c.run.exitCode,
      logPath: c.run.logPath,
    });
    if (b.run.failed > 0)
      book.executed(
        "gaps",
        `${b.run.failed} test(s) already fail on the baseline; they are not counted against the branch`,
        { command: cmd, exitCode: b.run.exitCode, logPath: b.run.logPath },
      );
    if (newFailures.length > 0) {
      vetoReasons.push(
        `${newFailures.length} test(s) pass on the baseline and fail on the candidate: ${newFailures.slice(0, 10).join("; ")}.`,
      );
      logTails.push({ logPath: c.run.logPath, tail: readLogTail(ctx, c.run.logPath) });
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
      "Tests were not run because an install failed.",
      "baseline or candidate install failed",
    );
  }

  // 3. Lint on the changed source files, same command on both sides.
  let baseLint: SideResult["lint"];
  let candLint: SideResult["lint"];
  let lintDelta = 0;
  const lintable = changedSource.filter((f) => eco.sourceFile.test(f));
  const lintInvocation = bothBuilt && lintable.length > 0 ? eco.lintCommand(toolchain, lintable) : undefined;
  if (lintInvocation) {
    const cmd = lintInvocation.command;
    const lint = async (ref: PreparedRef) => {
      const r = await sandbox.exec(ctx, ref, cmd, { label: "lint", timeoutMs: 15 * 60_000 });
      return {
        command: cmd,
        exitCode: r.exitCode,
        violations: r.exitCode === 0 ? 0 : countLintViolations(r.stdout + r.stderr),
        logPath: r.logPath,
      };
    };
    candLint = await lint(candidate);
    if (!toolchain.lintConfigProposed) {
      baseLint = await lint(baseline);
      lintDelta = candLint.violations - baseLint.violations;
      book.executed(
        "executed-results",
        `${lintInvocation.label} on changed files: baseline ${baseLint.violations}, candidate ${candLint.violations} violation(s)`,
        candLint,
      );
      if (lintDelta > 0)
        vetoReasons.push(
          `The branch adds ${lintDelta} lint violation(s) in changed files (see ${candLint.logPath}).`,
        );
    } else {
      book.executed(
        "executed-results",
        `${lintInvocation.label} (config added by Themis) reports ${candLint.violations} violation(s) in changed files`,
        candLint,
      );
      book.unverified(
        "gaps",
        "The baseline had no linter, so the lint delta could not be computed.",
        "no baseline lint config",
      );
    }
  }

  // 4. Security rescan on both trees (lockfile based; no project code executes).
  const scanSide = async (dir: string) => {
    const ids = new Set<string>();
    let first: { command: string; logPath: string; exitCode: number } | undefined;
    for (const scanner of eco.scanners) {
      const out = await scanner.scan(ctx, dir);
      if (!out.ok) continue;
      first ??= { command: out.command, logPath: out.logPath, exitCode: out.exitCode };
      for (const v of dedupeVulnerabilities(out.data)) ids.add(`${v.packageName}:${v.id}`);
    }
    return first
      ? {
          findings: ids.size,
          ids: [...ids].sort(),
          command: first.command,
          logPath: first.logPath,
          exitCode: first.exitCode,
        }
      : undefined;
  };
  const baseSec = await scanSide(ctx.repoPath);
  const candSec = await scanSide(worktree);
  const newSecurityIds = baseSec && candSec ? candSec.ids.filter((i) => !baseSec.ids.includes(i)) : [];
  const resolvedSecurityIds = baseSec && candSec ? baseSec.ids.filter((i) => !candSec.ids.includes(i)) : [];
  if (baseSec && candSec) {
    book.executed(
      "executed-results",
      `Security rescan: baseline ${baseSec.findings}, candidate ${candSec.findings} finding(s); ${resolvedSecurityIds.length} resolved, ${newSecurityIds.length} new`,
      candSec,
    );
    if (newSecurityIds.length > 0)
      vetoReasons.push(`The branch introduces vulnerabilities: ${newSecurityIds.join(", ")}.`);
  } else
    book.unverified(
      "gaps",
      "Security rescan did not run on both sides (no scanner available).",
      "scanners unavailable",
    );

  // 5. Rescan usage: after a replacement the old package must be gone.
  const usageRule = plan.rules.find((r) => !r.hasFix);
  let remaining: string[] = [];
  if (plan.strategy === "replace") {
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
      const files = listFiles(worktree, ".", 5000);
      remaining = eco
        .regexUsageMap(worktree, files, plan.dependency)
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

  // 6. Black-box probes, only when the app has a known start command and port.
  const baseProbes: ProbeResponse[] = [];
  const candProbes: ProbeResponse[] = [];
  const probeMismatches: Verification["delta"]["probeMismatches"] = [];
  let baseProbeLog: string | undefined;
  let candProbeLog: string | undefined;
  if (bothBuilt && toolchain.startCommand && toolchain.port && sandbox.kind === "docker" && llm) {
    const routeFiles = listFiles(worktree, ".", 3000)
      .filter((f) => /(routes?|api|server|app)\b/.test(f) && eco.sourceFile.test(f))
      .slice(0, 60);
    const choice = await runAgent(ctx, llm, {
      agent: "minos",
      label: `probes-a${attempt}`,
      task: "Choose up to 6 HTTP probes that reach code using the migrated dependency. Use fixed inputs. Only GET or small JSON POST.",
      data: {
        "usage-map.json": JSON.stringify(plan.usage, null, 2),
        "route-files.txt": routeFiles.join("\n"),
      },
      output: ProbeChoice,
      outputDescription: "Submit the probes.",
      maxSteps: 10,
    });
    const requests = choice.output.probes as ProbeRequest[];
    const service = { command: toolchain.startCommand, port: toolchain.port };
    const b = await sandbox.probe(ctx, baseline, service, requests);
    const c = await sandbox.probe(ctx, candidate, service, requests);
    baseProbes.push(...b.responses);
    candProbes.push(...c.responses);
    baseProbeLog = b.result.logPath;
    candProbeLog = c.result.logPath;
    for (const req of requests) {
      const x = b.responses.find((r) => r.path === req.path && r.method === req.method);
      const y = c.responses.find((r) => r.path === req.path && r.method === req.method);
      if (!x || !y) continue;
      if (x.status !== y.status || normalizeBody(x.body) !== normalizeBody(y.body))
        probeMismatches.push({
          path: `${req.method} ${req.path}`,
          baseline: `${x.status} ${x.body.slice(0, 500)}`,
          candidate: `${y.status} ${y.body.slice(0, 500)}`,
        });
    }
    book.executed(
      "executed-results",
      `Black-box probes: ${requests.length} sent to both apps, ${probeMismatches.length} mismatch(es)`,
      c.result,
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

  // 7. Call-site coverage: every call site of the migrated dependency is affected by the change, edited or not.
  // A site is covered when a passing candidate test names it as file:line.
  const touched = plan.usage.filter((s) => s.symbol !== "import");
  const covered = touched.filter((s) => candPassing.some((name) => name.includes(eco.siteTag(s))));
  const uncovered = touched.filter((s) => !covered.includes(s)).map((s) => `${s.file}:${s.line} ${s.symbol}`);
  const coverageText = `Call-site coverage: ${covered.length} of ${touched.length} affected call sites exercised by passing characterization tests`;
  if (candTests) book.executed("executed-results", coverageText, candTests);
  else book.unverified("executed-results", coverageText, "no tests ran on the candidate");
  for (const u of uncovered.slice(0, 50))
    book.unverified(
      "gaps",
      `Call site not covered by a passing test: ${u}`,
      "no characterization test names this site",
    );

  const passed = vetoReasons.length === 0;
  for (const r of vetoReasons)
    book.executed("executed-results", `Veto: ${r}`, candTests ?? candidate.install);

  const verification: Verification = VerificationSchema.parse({
    baseline: {
      ref: findings.baseRef,
      commit: findings.baseCommit,
      install: { exitCode: baseline.install.exitCode, logPath: baseline.install.logPath },
      tests: baseTests,
      lint: baseLint,
      security: baseSec,
      probes: baseProbes,
      probeLogPath: baseProbeLog,
    },
    candidate: {
      ref: migration.branch,
      commit: candidateCommit,
      install: { exitCode: candidate.install.exitCode, logPath: candidate.install.logPath },
      tests: candTests,
      lint: candLint,
      security: candSec,
      probes: candProbes,
      probeLogPath: candProbeLog,
    },
    delta: { newFailures, fixedFailures, lintDelta, newSecurityIds, resolvedSecurityIds, probeMismatches },
    coverage: { covered: covered.length, total: touched.length, uncovered },
    passed,
    vetoReasons,
    attempt,
    claims: book.claims,
  });
  writeJson(ctx, `verification-attempt-${attempt}.json`, verification);
  writeJson(ctx, "verification.json", verification);
  logEvent(
    ctx,
    `minos: ${passed ? "passed" : `vetoed (${vetoReasons.length} reason(s))`}; coverage ${covered.length}/${touched.length}`,
  );

  return {
    verification,
    feedback: {
      reasons: vetoReasons,
      failingTests: newFailures,
      logTails: logTails.map((l) => ({ ...l, tail: l.tail.slice(-8000) })),
    },
  };
}
