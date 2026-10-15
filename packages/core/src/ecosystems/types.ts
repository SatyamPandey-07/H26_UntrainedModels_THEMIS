import type { ClaimBook } from "../evidence/claims.js";
import type { RunContext } from "../run/context.js";
import type { ParsedTests } from "../sandbox/tests.js";
import type { Toolchain, UsageSite } from "../schema/stages.js";
import type { DependencyGraph } from "../tools/lockfile.js";
import type { RegistryInfo } from "../tools/registry.js";
import type { Scanner } from "../tools/types.js";

export type EcosystemId = "node" | "python";

export interface RuleFile {
  rules: Array<Record<string, unknown> & { id: string }>;
}

/** Wording that differs between ecosystems; the Node values are the original literals. */
export interface EcosystemLabels {
  /** "npm" or "PyPI". */
  registry: string;
  /** "npm package" or "PyPI package", used in model prompts. */
  packageNoun: string;
  /** Manifest cited when no better source exists. */
  manifest: string;
  noTestReason: string;
  noLinterGap: string;
  noLinterReason: string;
  registryGapReason: string;
}

export interface GraphResult {
  graph: DependencyGraph;
  /** Facts the graph could not establish (unpinned entries, URL requirements, ...). Reported as UNVERIFIED. */
  gaps: string[];
}

export interface LintInvocation {
  command: string;
  /** Linter name used in claim text, e.g. "ESLint". */
  label: string;
}

export interface EditContext {
  ctx: RunContext;
  worktree: string;
  toolchain: Toolchain;
  book: ClaimBook;
}

export interface EditOutcome {
  ok: boolean;
  /** Files to stage in the concern's commit. */
  files: string[];
  error?: string;
}

export interface DependencyChange {
  strategy: "upgrade" | "replace";
  dependency: string;
  target: { name: string; version: string };
  dev: boolean;
}

/**
 * Everything the pipeline needs to know about a language ecosystem. The Node implementation delegates to the
 * original functions unchanged; a second language is a new module that implements this interface.
 */
export interface Ecosystem {
  readonly id: EcosystemId;
  readonly labels: EcosystemLabels;
  /** Script inside the toolchain-detect skill that prints the Toolchain JSON. */
  readonly detectScript: string;
  readonly sourceFile: RegExp;
  readonly testFile: RegExp;
  readonly ruleLanguages: string[];
  /** Extra directories passed to Opengrep as --exclude (the Node list is empty: its command is unchanged). */
  readonly opengrepExcludes: string[];
  /** Reference file inside the characterization-tests skill. */
  readonly testShapesReference: string;
  /** The lint-configuration concern added to a plan when the project has no linter. */
  readonly lintConcern: { files: string[]; instructions: string };
  readonly scanners: Scanner[];

  normalizeName(name: string): string;
  readDependencyGraph(repoPath: string, toolchain: Toolchain): Promise<GraphResult>;
  registryInfo(name: string, installedVersion?: string): Promise<RegistryInfo | undefined>;
  registryUrl(name: string): string;

  importRule(pkg: string): RuleFile;
  regexUsageMap(repoPath: string, files: string[], pkg: string): UsageSite[];
  /** Extra named inputs for the Planner's rule-writing prompt. */
  promptContext(pkg: string, repoPath: string, files: string[]): Record<string, string>;
  /** Files listed on the plan's dependency concern. */
  planManifestFiles(toolchain: Toolchain): string[];

  /** Lint config concern; the Node implementation lives in the Migrator, so this is absent for Node. */
  proposeLintConfig?(e: EditContext): Promise<EditOutcome>;
  /** Dependency concern; absent for Node (the Migrator drives the package manager itself). */
  applyDependencyChange?(e: EditContext, change: DependencyChange): Promise<EditOutcome>;

  testCommand(toolchain: Toolchain, files: string[], opts?: { related?: string[] }): string;
  singleTestCommand(toolchain: Toolchain, file: string): string;
  parseTestOutput(stdout: string, exitCode: number): ParsedTests;
  /** Existing test files that exercise the changed source files; merged into the verifier's test selection. */
  relatedTestFiles?(worktree: string, changedSource: string[], tracked: string[]): string[];

  lintCommand(toolchain: Toolchain, files: string[]): LintInvocation | undefined;

  isCharacterizationTest(path: string, slug: string): boolean;
  /** Instructions telling the model how to name and place characterization tests. */
  characterizationHint(slug: string, toolchain: Toolchain): string;
  /** Extra named inputs for the characterization-test prompt. */
  characterizationData?(usage: UsageSite[]): Record<string, string>;
  /** Token a passing test name must contain to count as covering a call site. */
  siteTag(site: { file: string; line: number }): string;
}
