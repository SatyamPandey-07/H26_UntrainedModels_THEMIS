import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "../run/context.js";
import { logEvent, writeJson } from "../run/context.js";
import { AGENT_ROLES } from "../schema/claim.js";
import type { CapsuleSection, Claim } from "../schema/claim.js";
import { Capsule as CapsuleSchema } from "../schema/capsule.js";
import type { Capsule, Verdict } from "../schema/capsule.js";
import type { Findings, MigrationPlan, MigrationResult, Verification } from "../schema/stages.js";
import { readSkillFile } from "../skills/loader.js";
import { changedFiles } from "../tools/git.js";
import { slugify } from "../util/misc.js";
import { gateClaims } from "./gate.js";

export interface CapsuleInput {
  findings?: Findings;
  plan?: MigrationPlan;
  migration?: MigrationResult;
  verification?: Verification;
  /** Claims from the orchestrator itself (stage failures, retry cap reached, isolation notes). */
  extraClaims?: Claim[];
  dependency?: string;
}

export interface CheckRunOutput {
  conclusion: "success" | "neutral" | "action_required";
  title: string;
  summary: string;
  annotations: Array<{
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: "notice" | "warning";
    message: string;
  }>;
}

export interface CapsuleOutput {
  capsule: Capsule;
  capsuleMd: string;
  prBody: string;
  checkRun: CheckRunOutput;
}

const SECTION_ORDER: CapsuleSection[] = [
  "maintenance-problem",
  "dependency-details",
  "risk-indicators",
  "usage-locations",
  "ai-analysis",
  "proposed-changes",
  "suggested-tests",
  "executed-results",
  "gaps",
  "unresolved",
];

const MAX_PR_BODY = 60_000;

/** Repository-relative location the publisher commits the capsule to on the Themis branch. */
export function capsuleRepoPath(dependency: string): string {
  return `.themis/${slugify(dependency)}/capsule.md`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z:-]+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function evidenceText(claim: Claim): string {
  const ev = claim.evidence;
  switch (ev.kind) {
    case "command":
      return `\`${ev.command.length > 120 ? `${ev.command.slice(0, 117)}...` : ev.command}\` → exit ${ev.exitCode}, log \`${ev.logPath}\``;
    case "source":
      return ev.file ? `\`${ev.file}${ev.line ? `:${ev.line}` : ""}\`` : ev.url ? `<${ev.url}>` : "source";
    case "model":
      return `${ev.model}; inputs: ${ev.inputs.join(", ") || "none"}`;
    case "none":
      return ev.reason;
  }
}

function claimLines(claims: Claim[]): string {
  if (claims.length === 0) return "None recorded.";
  return claims
    .map((c) => `- **${c.tag}** · ${AGENT_ROLES[c.agent]} · ${c.text}\n  <sub>${evidenceText(c)}</sub>`)
    .join("\n");
}

export function decideVerdict(input: CapsuleInput, claims: Claim[]): Verdict {
  const { plan, migration, verification } = input;
  if (!plan || !plan.feasible) return "Not recommended";
  if (!migration || migration.commits.length === 0) return "Not recommended";
  const unresolved = claims.some((c) => c.section === "unresolved");
  const fullCoverage = verification ? verification.coverage.covered === verification.coverage.total : false;
  if (verification?.passed && fullCoverage && !unresolved) return "Migrated and verified";
  return "Migrated, gaps remain";
}

function resultsTable(v: Verification | undefined): string {
  if (!v) return "Verification did not run.";
  const t = (r: Verification["baseline"]) =>
    r.tests ? `${r.tests.passed} passed, ${r.tests.failed} failed (\`${r.tests.logPath}\`)` : "not run";
  const l = (r: Verification["baseline"]) =>
    r.lint ? `${r.lint.violations} (\`${r.lint.logPath}\`)` : "not run";
  const s = (r: Verification["baseline"]) =>
    r.security ? `${r.security.findings} (\`${r.security.logPath}\`)` : "not run";
  return [
    "| Check | Baseline | Candidate |",
    "|---|---|---|",
    `| Ref | \`${v.baseline.ref}\` @ ${v.baseline.commit.slice(0, 7)} | \`${v.candidate.ref}\` @ ${v.candidate.commit.slice(0, 7)} |`,
    `| Install | exit ${v.baseline.install.exitCode} (\`${v.baseline.install.logPath}\`) | exit ${v.candidate.install.exitCode} (\`${v.candidate.install.logPath}\`) |`,
    `| Tests | ${t(v.baseline)} | ${t(v.candidate)} |`,
    `| Lint violations | ${l(v.baseline)} | ${l(v.candidate)} |`,
    `| Security findings | ${s(v.baseline)} | ${s(v.candidate)} |`,
    "",
    `New failures: ${v.delta.newFailures.length ? v.delta.newFailures.map((f) => `\`${escapeCell(f)}\``).join(", ") : "none"}.`,
    `Call-site coverage: ${v.coverage.covered} of ${v.coverage.total}.`,
    v.vetoReasons.length
      ? `\n**Verifier veto:**\n${v.vetoReasons.map((r) => `- ${r}`).join("\n")}`
      : "\nVerifier: no veto.",
  ].join("\n");
}

/**
 * Clio: assembles capsule.json, capsule.md, the PR body and the Check Run from stage outputs only.
 * Deterministic: no model is called here.
 */
export async function writeCapsule(ctx: RunContext, input: CapsuleInput): Promise<CapsuleOutput> {
  const { findings, plan, migration, verification } = input;
  const raw: Claim[] = [
    ...(findings?.claims ?? []),
    ...(plan?.claims ?? []),
    ...(migration?.claims ?? []),
    ...(verification?.claims ?? []),
    ...(input.extraClaims ?? []),
  ];
  const { claims, downgraded } = gateClaims(ctx, raw);
  const verdict = decideVerdict(input, claims);
  const dependency = plan?.dependency ?? input.dependency ?? findings?.dependencies[0]?.name ?? "unknown";
  const depFinding = findings?.dependencies.find((d) => d.name === dependency);
  // The branch outlives the worktree, so diff it from the repository itself.
  const files = migration
    ? await changedFiles(ctx.repoPath, migration.baseCommit, migration.branch).catch(() => [])
    : [];

  const capsule: Capsule = CapsuleSchema.parse({
    schemaVersion: "1",
    runId: ctx.runId,
    generatedAt: new Date().toISOString(),
    repository: ctx.state.repository,
    dependency: {
      name: dependency,
      from: plan?.fromVersion ?? depFinding?.currentVersion ?? "unknown",
      to: plan ? `${plan.target.name}@${plan.target.version}` : undefined,
      strategy: plan?.strategy,
    },
    verdict,
    confidence: plan?.confidence ?? "low",
    branch: migration?.branch,
    filesChanged: files,
    summary: {
      callSites: verification?.coverage.total ?? plan?.usage.filter((s) => s.symbol !== "import").length ?? 0,
      callSitesCovered: verification?.coverage.covered ?? 0,
      newTestFailures: verification?.delta.newFailures.length ?? 0,
      lintDelta: verification?.delta.lintDelta ?? 0,
      newSecurityFindings: verification?.delta.newSecurityIds.length ?? 0,
      probeMismatches: verification?.delta.probeMismatches.length ?? 0,
    },
    claims,
    downgraded,
    toolVersions: ctx.toolVersions,
  });

  const bySection = (s: CapsuleSection) => claims.filter((c) => c.section === s);
  const sectionValues = Object.fromEntries(
    SECTION_ORDER.map((s) => [`section:${s}`, claimLines(bySection(s))]),
  );
  if (downgraded.length > 0)
    sectionValues["section:unresolved"] +=
      `\n\n**Claims downgraded by the evidence gate:**\n${downgraded.map((d) => `- \`${d.claimId}\` (${d.from}): ${d.reason}`).join("\n")}`;

  const capsuleMd = fill(readSkillFile("capsule-write", "assets/capsule.md"), {
    dependency,
    verdict,
    confidence: capsule.confidence,
    runId: ctx.runId,
    repository: capsule.repository,
    from: capsule.dependency.from,
    to: capsule.dependency.to ?? "n/a",
    branch: capsule.branch ? `\`${capsule.branch}\`` : "n/a",
    ...sectionValues,
  });

  const usage = plan?.usage ?? [];
  const usageMap = usage.length
    ? [
        "| File | Line | Symbol | Rule |",
        "|---|---|---|---|",
        ...usage
          .slice(0, 150)
          .map((s) => `| \`${s.file}\` | ${s.line} | \`${escapeCell(s.symbol)}\` | ${s.ruleId} |`),
      ].join("\n") + (usage.length > 150 ? `\n\n${usage.length - 150} more sites in the full capsule.` : "")
    : "No usage sites recorded.";
  const rules = plan?.rules.length
    ? plan.rules.map((r) => `- \`${r.id}\`${r.hasFix ? " (fix)" : ""} from \`${r.path}\``).join("\n")
    : "No rules recorded.";
  const rationale = plan
    ? [
        plan.rationale,
        "",
        ...plan.behavioralDifferences.map((d) => `- ${d}`),
        "",
        ...(migration?.commits ?? []).map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.message}`),
      ].join("\n")
    : "No plan was produced.";
  const lintSecurity = verification
    ? [
        `Lint delta on changed files: ${verification.delta.lintDelta >= 0 ? "+" : ""}${verification.delta.lintDelta}.`,
        `New vulnerabilities: ${verification.delta.newSecurityIds.join(", ") || "none"}.`,
        `Resolved vulnerabilities: ${verification.delta.resolvedSecurityIds.join(", ") || "none"}.`,
      ].join("\n")
    : "Not run.";
  const probes = verification?.candidate.probes.length
    ? [
        "| Request | Baseline | Candidate |",
        "|---|---|---|",
        ...verification.candidate.probes.map((p) => {
          const b = verification.baseline.probes.find((x) => x.path === p.path && x.method === p.method);
          return `| \`${p.method} ${p.path}\` | ${b?.status ?? "-"} | ${p.status} |`;
        }),
        "",
        `Mismatches: ${verification.delta.probeMismatches.length}.`,
      ].join("\n")
    : "Black-box probes were not run for this repository.";
  const gapClaims = [...bySection("gaps"), ...bySection("unresolved")];

  let prBody = fill(readSkillFile("pr-report", "assets/pr-body.md"), {
    verdict,
    confidence: capsule.confidence,
    dependency,
    from: capsule.dependency.from,
    to: capsule.dependency.to ?? "n/a",
    filesChanged: String(files.length),
    covered: String(capsule.summary.callSitesCovered),
    callSites: String(capsule.summary.callSites),
    score: String(depFinding?.score ?? "n/a"),
    usageMap,
    rules,
    rationale,
    results: resultsTable(verification),
    lintSecurity,
    probes,
    gaps: claimLines(gapClaims),
    capsulePath: capsuleRepoPath(dependency),
  });
  if (prBody.length > MAX_PR_BODY)
    prBody = `${prBody.slice(0, MAX_PR_BODY)}\n\n_Truncated; see the full capsule._`;

  const uncoveredSites = new Set((verification?.coverage.uncovered ?? []).map((u) => u.split(" ")[0]));
  const annotations: CheckRunOutput["annotations"] = usage
    .filter((s) => files.includes(s.file) || plan?.strategy === "upgrade")
    .slice(0, 50)
    .map((s) => {
      const uncovered = uncoveredSites.has(`${s.file}:${s.line}`);
      return {
        path: s.file,
        start_line: s.line,
        end_line: s.endLine ?? s.line,
        annotation_level: uncovered && s.symbol !== "import" ? "warning" : "notice",
        message:
          s.symbol === "import"
            ? `Imports ${dependency}.`
            : `Uses ${dependency} (\`${s.symbol}\`); ${uncovered ? "no characterization test covers this call site" : "covered by a characterization test"}.`,
      };
    });
  const checkRun: CheckRunOutput = {
    conclusion:
      verdict === "Migrated and verified"
        ? "success"
        : verdict === "Migrated, gaps remain"
          ? "neutral"
          : "action_required",
    title: `Themis: ${verdict}`,
    summary: [
      `**${dependency}** ${capsule.dependency.from} → ${capsule.dependency.to ?? "n/a"} (confidence: ${capsule.confidence})`,
      `Call sites covered: ${capsule.summary.callSitesCovered} of ${capsule.summary.callSites}; new test failures: ${capsule.summary.newTestFailures}; lint delta: ${capsule.summary.lintDelta}; new vulnerabilities: ${capsule.summary.newSecurityFindings}.`,
      downgraded.length
        ? `${downgraded.length} claim(s) downgraded by the evidence gate.`
        : "All claims passed the evidence gate.",
    ].join("\n\n"),
    annotations,
  };

  writeJson(ctx, "capsule.json", capsule);
  writeFileSync(join(ctx.runDir, "capsule.md"), capsuleMd);
  writeFileSync(join(ctx.runDir, "pr-body.md"), prBody);
  writeJson(ctx, "check-run.json", checkRun);
  logEvent(ctx, `clio: ${verdict}; ${claims.length} claim(s), ${downgraded.length} downgraded`);
  return { capsule, capsuleMd, prBody, checkRun };
}
