import type { DependencyFinding, Findings } from "./schema/stages.js";

const risky = (d: DependencyFinding) => d.risk.vulnerabilities.length > 0 || d.risk.deprecated;

/** A dependency no source file imports (a CLI, a type package) has nothing to migrate in code. */
const migratable = (d: DependencyFinding) => d.importingFiles === undefined || d.importingFiles > 0;

/** Risk per affected file: the score discounted by the blast radius. */
export function migrationPriority(d: DependencyFinding): number {
  return d.score / (1 + Math.log2(1 + (d.importingFiles ?? 1)));
}

/**
 * Migration candidates in the order Themis proposes them: runtime dependencies with a known vulnerability or
 * deprecation first, then dev dependencies, each ordered by risk per affected file.
 */
export function rankCandidates(findings: Findings, ignore: string[] = []): DependencyFinding[] {
  const pool = findings.dependencies.filter((d) => risky(d) && migratable(d) && !ignore.includes(d.name));
  const order = (a: DependencyFinding, b: DependencyFinding) =>
    migrationPriority(b) - migrationPriority(a) || b.score - a.score;
  return [...pool.filter((d) => !d.dev).sort(order), ...pool.filter((d) => d.dev).sort(order)];
}

/**
 * The dependency Themis migrates when none is named: the first migration candidate, else the highest-ranked
 * runtime dependency that source code imports.
 */
export function recommendDependency(findings: Findings): DependencyFinding | undefined {
  return (
    rankCandidates(findings)[0] ??
    findings.dependencies.find((d) => !d.dev && migratable(d)) ??
    findings.dependencies[0]
  );
}
