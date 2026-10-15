import type { DependencyFinding, Findings } from "@themis/core";

export const DASHBOARD_MARKER = "<!-- themis:dashboard -->";
export const DASHBOARD_TITLE = "Themis Dependency Dashboard";

/** Same rule as the engine's branch names: `themis/<slug>-<YYYYMMDD>`. */
export function dependencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface DashboardLinks {
  /** Open Themis PRs keyed by dependency slug (from the branch name). */
  openPrs?: Record<string, { number: number; url: string }>;
  runUrl?: string;
  recommended?: string;
  /** Proposal issues keyed by dependency name. */
  proposals?: Record<string, { number: number; url: string }>;
}

function signals(d: DependencyFinding): string {
  const parts: string[] = [];
  if (d.risk.vulnerabilities.length > 0)
    parts.push(
      `${d.risk.vulnerabilities.length} vulnerabilit${d.risk.vulnerabilities.length === 1 ? "y" : "ies"}`,
    );
  if (d.risk.deprecated) parts.push("deprecated");
  if (d.risk.latestVersion && d.risk.latestVersion !== d.currentVersion)
    parts.push(`latest ${d.risk.latestVersion}`);
  if (d.risk.ageDays !== undefined && d.risk.ageDays > 365)
    parts.push(`last release ${Math.floor(d.risk.ageDays / 365)}y ago`);
  if (d.importingFiles !== undefined)
    parts.push(
      d.importingFiles === 0
        ? "not imported in source"
        : `used in ${d.importingFiles} file${d.importingFiles === 1 ? "" : "s"}`,
    );
  return parts.join(", ") || "no risk signals";
}

/** Renders the Dependency Dashboard issue body. Ticking a box asks Themis to migrate that dependency. */
export function renderDashboard(findings: Findings, links: DashboardLinks = {}, limit = 25): string {
  const deps = findings.dependencies.slice(0, limit);
  const rows = deps.map((d) => {
    const pr = links.openPrs?.[dependencySlug(d.name)];
    const proposal = links.proposals?.[d.name];
    const box = pr ? `- [x] Migrate \`${d.name}\` (draft PR #${pr.number})` : `- [ ] Migrate \`${d.name}\``;
    return `${box} · score ${d.score} · ${d.currentVersion}${d.dev ? " (dev)" : ""} · ${signals(d)}${proposal ? ` · proposal #${proposal.number}` : ""}`;
  });
  return [
    DASHBOARD_MARKER,
    "Themis ranked this repository's direct dependencies by maintenance risk and opened a proposal issue for each",
    "top candidate. Comment `/themis plan` on a proposal to see the plan, or `/themis migrate` to act on it; ticking a",
    "box here also starts a migration. Themis migrates on its own branch, verifies against the default branch in a",
    "sandbox, and opens a draft pull request with an evidence capsule. Themis never merges and never writes to the",
    "default branch.",
    "",
    links.recommended ? `**Recommended next:** \`${links.recommended}\`` : "",
    "",
    ...rows,
    "",
    findings.dependencies.length > limit
      ? `${findings.dependencies.length - limit} lower-risk dependencies not shown.`
      : "",
    "",
    `<sub>Scanned ${findings.baseRef} @ ${findings.baseCommit.slice(0, 7)} on ${new Date().toISOString().slice(0, 10)}${
      links.runUrl ? ` · [run log](${links.runUrl})` : ""
    } · Comment \`/themis <package>\` on any issue to request a migration.</sub>`,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

const BOX_RE = /^- \[([ xX])\] Migrate `([^`]+)`/;

/** Packages whose box changed from unticked to ticked between two versions of the dashboard body. */
export function newlyTicked(before: string, after: string): string[] {
  const state = (body: string) => {
    const map = new Map<string, boolean>();
    for (const line of body.split("\n")) {
      const m = BOX_RE.exec(line.trim());
      if (m) map.set(m[2] as string, m[1] !== " ");
    }
    return map;
  };
  const prev = state(before);
  return [...state(after)]
    .filter(([name, ticked]) => ticked && prev.get(name) === false)
    .map(([name]) => name);
}

export function isDashboard(body: string | null | undefined): boolean {
  return Boolean(body?.includes(DASHBOARD_MARKER));
}

/** Hidden marker on a proposal issue; the package is read back when someone comments `/themis plan|migrate`. */
export function proposalMarker(pkg: string): string {
  return `<!-- themis:proposal package="${pkg}" -->`;
}

export function proposalPackage(body: string | null | undefined): string | undefined {
  return /<!-- themis:proposal package="([^"]+)" -->/.exec(body ?? "")?.[1];
}
