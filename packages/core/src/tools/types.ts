import type { RunContext } from "../run/context.js";
import type { UsageSite, Vulnerability } from "../schema/stages.js";

/** Result of a tool that may be missing or fail; callers turn `unavailable` into an UNVERIFIED claim. */
export type ToolOutcome<T> =
  | { ok: true; data: T; command: string; exitCode: number; logPath: string }
  | {
      ok: false;
      unavailable: boolean;
      reason: string;
      command?: string;
      exitCode?: number;
      logPath?: string;
    };

export interface PackageVulnerability extends Vulnerability {
  packageName: string;
  installedVersion?: string;
}

/** Vulnerability scanners (npm audit, OSV-Scanner, Trivy). A second language adds implementations. */
export interface Scanner {
  readonly name: string;
  scan(ctx: RunContext, repoPath: string): Promise<ToolOutcome<PackageVulnerability[]>>;
}

/** Maps where a dependency is used. */
export interface Mapper {
  readonly name: string;
  map(ctx: RunContext, repoPath: string, rulesPath: string): Promise<ToolOutcome<UsageSite[]>>;
}

/** Runs a project's linter and counts violations. */
export interface Linter {
  readonly name: string;
  lint(ctx: RunContext, repoPath: string, command: string): Promise<ToolOutcome<{ violations: number }>>;
}
