import type { DependencyFinding, Findings } from "./schema/stages.js";

/**
 * The dependency Themis migrates when none is named: among runtime dependencies with a known
 * vulnerability or deprecation, the one with the most risk per importing file (its blast radius).
 */
export function recommendDependency(findings: Findings): DependencyFinding | undefined {
  const deps = findings.dependencies;
  const risky = (d: DependencyFinding) => d.risk.vulnerabilities.length > 0 || d.risk.deprecated;
  // Prefer risk that is realistic to migrate: the score is discounted by the number of importing files, and a
  // dependency no source file imports (a CLI, a type package) has nothing to migrate in code.
  const priority = (d: DependencyFinding) => d.score / (1 + Math.log2(1 + (d.importingFiles ?? 1)));
  const migratable = (d: DependencyFinding) => d.importingFiles === undefined || d.importingFiles > 0;
  const best = (pool: DependencyFinding[]) =>
    [...pool].sort((a, b) => priority(b) - priority(a) || b.score - a.score)[0];
  return (
    best(deps.filter((d) => !d.dev && risky(d) && migratable(d))) ??
    best(deps.filter((d) => risky(d) && migratable(d))) ??
    deps.find((d) => !d.dev && migratable(d)) ??
    deps[0]
  );
}
