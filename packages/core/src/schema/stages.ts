import { z } from "zod";
import { Claim } from "./claim.js";

/* ---------- Scout: findings.json ---------- */

export const Toolchain = z.object({
  language: z.enum(["javascript", "typescript", "python"]),
  packageManager: z.enum(["npm", "pnpm", "yarn", "pip"]),
  nodeVersion: z.string().optional(),
  /** Python only: interpreter version from .python-version, runtime.txt or requires-python. */
  pythonVersion: z.string().optional(),
  /** Python only: requirements files (relative paths) that declare dependencies. */
  requirementsFiles: z.array(z.string()).optional(),
  testRunner: z.string().optional(),
  testCommand: z.string().optional(),
  formatter: z.string().optional(),
  linters: z.array(z.string()),
  lintCommand: z.string().optional(),
  /** True when Scout proposed a minimal lint config because none existed (F1). */
  lintConfigProposed: z.boolean(),
  startCommand: z.string().optional(),
  port: z.number().int().optional(),
});
export type Toolchain = z.infer<typeof Toolchain>;

export const Vulnerability = z.object({
  id: z.string(),
  severity: z.string(),
  summary: z.string(),
  fixedIn: z.string().optional(),
  source: z.string(),
});
export type Vulnerability = z.infer<typeof Vulnerability>;

export const RiskIndicators = z.object({
  vulnerabilities: z.array(Vulnerability),
  deprecated: z.boolean(),
  deprecationMessage: z.string().optional(),
  latestVersion: z.string().optional(),
  lastPublish: z.string().optional(),
  ageDays: z.number().optional(),
  maintainers: z.number().optional(),
  weeklyDownloads: z.number().optional(),
  transitiveCount: z.number(),
});
export type RiskIndicators = z.infer<typeof RiskIndicators>;

export const DependencyFinding = z.object({
  name: z.string(),
  currentVersion: z.string(),
  declaredRange: z.string(),
  dev: z.boolean(),
  score: z.number(),
  risk: RiskIndicators,
  rationale: z.string().optional(),
});
export type DependencyFinding = z.infer<typeof DependencyFinding>;

export const LintResult = z.object({
  command: z.string(),
  exitCode: z.number().int(),
  violations: z.number().int(),
  logPath: z.string(),
});
export type LintResult = z.infer<typeof LintResult>;

export const Findings = z.object({
  repoPath: z.string(),
  baseRef: z.string(),
  baseCommit: z.string(),
  toolchain: Toolchain,
  lintBaseline: LintResult.optional(),
  dependencies: z.array(DependencyFinding),
  claims: z.array(Claim),
});
export type Findings = z.infer<typeof Findings>;

/* ---------- Planner: plan.json ---------- */

export const UsageSite = z.object({
  file: z.string(),
  line: z.number().int(),
  endLine: z.number().int().optional(),
  symbol: z.string(),
  ruleId: z.string(),
  snippet: z.string(),
});
export type UsageSite = z.infer<typeof UsageSite>;

export const ConcernKind = z.enum(["toolchain", "dependency", "autofix", "model-edit", "tests"]);
export type ConcernKind = z.infer<typeof ConcernKind>;

export const Concern = z.object({
  id: z.string(),
  kind: ConcernKind,
  title: z.string(),
  files: z.array(z.string()),
  instructions: z.string(),
});
export type Concern = z.infer<typeof Concern>;

export const MigrationPlan = z.object({
  dependency: z.string(),
  fromVersion: z.string(),
  strategy: z.enum(["upgrade", "replace"]),
  target: z.object({ name: z.string(), version: z.string() }),
  rules: z.array(z.object({ id: z.string(), path: z.string(), hasFix: z.boolean() })),
  usage: z.array(UsageSite),
  concerns: z.array(Concern),
  rationale: z.string(),
  behavioralDifferences: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  feasible: z.boolean(),
  claims: z.array(Claim),
});
export type MigrationPlan = z.infer<typeof MigrationPlan>;

/* ---------- Migrator: migration.json ---------- */

export const MigrationResult = z.object({
  branch: z.string(),
  worktreePath: z.string(),
  baseCommit: z.string(),
  commits: z.array(z.object({ sha: z.string(), concernId: z.string(), message: z.string() })),
  keptTests: z.array(z.string()),
  discardedTests: z.array(z.object({ file: z.string(), reason: z.string(), logPath: z.string().optional() })),
  attempt: z.number().int(),
  claims: z.array(Claim),
});
export type MigrationResult = z.infer<typeof MigrationResult>;

/* ---------- Verifier: verification.json ---------- */

export const TestRun = z.object({
  command: z.string(),
  exitCode: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  total: z.number().int(),
  failingTests: z.array(z.string()),
  logPath: z.string(),
});
export type TestRun = z.infer<typeof TestRun>;

export const ProbeResult = z.object({
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  body: z.string(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;

export const SideResult = z.object({
  ref: z.string(),
  commit: z.string(),
  install: z.object({ exitCode: z.number().int(), logPath: z.string() }),
  tests: TestRun.optional(),
  lint: LintResult.optional(),
  security: z
    .object({
      findings: z.number().int(),
      ids: z.array(z.string()),
      logPath: z.string(),
      exitCode: z.number().int(),
    })
    .optional(),
  probes: z.array(ProbeResult),
  probeLogPath: z.string().optional(),
});
export type SideResult = z.infer<typeof SideResult>;

export const Verification = z.object({
  baseline: SideResult,
  candidate: SideResult,
  delta: z.object({
    newFailures: z.array(z.string()),
    fixedFailures: z.array(z.string()),
    lintDelta: z.number().int(),
    newSecurityIds: z.array(z.string()),
    resolvedSecurityIds: z.array(z.string()),
    probeMismatches: z.array(z.object({ path: z.string(), baseline: z.string(), candidate: z.string() })),
  }),
  coverage: z.object({
    covered: z.number().int(),
    total: z.number().int(),
    uncovered: z.array(z.string()),
  }),
  passed: z.boolean(),
  vetoReasons: z.array(z.string()),
  attempt: z.number().int(),
  claims: z.array(Claim),
});
export type Verification = z.infer<typeof Verification>;
