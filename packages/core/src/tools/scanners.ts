import { existsSync } from "node:fs";
import { join } from "node:path";
import { recordToolVersion, runCommand } from "../evidence/command.js";
import { safeJson } from "../util/misc.js";
import type { PackageVulnerability, Scanner, ToolOutcome } from "./types.js";

function normalizeSeverity(value: unknown): string {
  const s = String(value ?? "").toLowerCase();
  if (s.startsWith("crit")) return "critical";
  if (s.startsWith("high")) return "high";
  if (s.startsWith("mod") || s.startsWith("med")) return "moderate";
  if (s.startsWith("low")) return "low";
  return "unknown";
}

/* ---------- npm audit ---------- */

interface NpmAuditJson {
  vulnerabilities?: Record<
    string,
    {
      name: string;
      severity: string;
      range?: string;
      via: Array<
        string | { source?: number; title?: string; url?: string; severity?: string; range?: string }
      >;
      fixAvailable?: boolean | { name: string; version: string };
    }
  >;
}

export const npmAudit: Scanner = {
  name: "npm-audit",
  async scan(ctx, repoPath): Promise<ToolOutcome<PackageVulnerability[]>> {
    if (!existsSync(join(repoPath, "package-lock.json")))
      return { ok: false, unavailable: true, reason: "npm audit needs package-lock.json" };
    await recordToolVersion(ctx, "npm", "npm");
    const r = await runCommand(ctx, {
      label: "npm-audit",
      file: "npm",
      args: ["audit", "--json", "--package-lock-only"],
      cwd: repoPath,
      timeoutMs: 180_000,
    });
    const json = safeJson<NpmAuditJson>(r.stdout);
    if (!json?.vulnerabilities)
      return { ok: false, unavailable: false, reason: "npm audit produced no JSON report", ...r };
    const out: PackageVulnerability[] = [];
    for (const [pkg, v] of Object.entries(json.vulnerabilities)) {
      for (const via of v.via) {
        if (typeof via === "string") continue; // transitive pointer, reported under the other package
        out.push({
          packageName: pkg,
          id: via.url?.split("/").pop() ?? `npm-${via.source ?? pkg}`,
          severity: normalizeSeverity(via.severity ?? v.severity),
          summary: via.title ?? "npm advisory",
          fixedIn: typeof v.fixAvailable === "object" ? v.fixAvailable.version : undefined,
          source: "npm-audit",
        });
      }
    }
    return { ok: true, data: out, command: r.command, exitCode: r.exitCode, logPath: r.logPath };
  },
};

/* ---------- OSV-Scanner v2 ---------- */

interface OsvJson {
  results?: Array<{
    packages?: Array<{
      package: { name: string; version?: string; ecosystem?: string };
      vulnerabilities?: Array<{
        id: string;
        summary?: string;
        aliases?: string[];
        database_specific?: { severity?: string };
        affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
      }>;
    }>;
  }>;
}

export const osvScanner: Scanner = {
  name: "osv-scanner",
  async scan(ctx, repoPath) {
    if (!(await recordToolVersion(ctx, "osv-scanner", "osv-scanner")))
      return { ok: false, unavailable: true, reason: "osv-scanner is not installed" };
    const lockfile = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) =>
      existsSync(join(repoPath, f)),
    );
    if (!lockfile) return { ok: false, unavailable: true, reason: "no lockfile for osv-scanner" };
    const r = await runCommand(ctx, {
      label: "osv-scanner",
      file: "osv-scanner",
      args: ["scan", "source", "--format", "json", "--lockfile", lockfile],
      cwd: repoPath,
      timeoutMs: 300_000,
    });
    const json = safeJson<OsvJson>(r.stdout);
    if (!json) return { ok: false, unavailable: false, reason: "osv-scanner produced no JSON report", ...r };
    const out: PackageVulnerability[] = [];
    for (const res of json.results ?? [])
      for (const p of res.packages ?? [])
        for (const v of p.vulnerabilities ?? []) {
          const fixed = v.affected
            ?.flatMap((a) => a.ranges ?? [])
            .flatMap((rg) => rg.events ?? [])
            .find((e) => e.fixed)?.fixed;
          out.push({
            packageName: p.package.name,
            installedVersion: p.package.version,
            id: v.aliases?.find((a) => a.startsWith("GHSA")) ?? v.id,
            severity: normalizeSeverity(v.database_specific?.severity),
            summary: v.summary ?? v.id,
            fixedIn: fixed,
            source: "osv-scanner",
          });
        }
    return { ok: true, data: out, command: r.command, exitCode: r.exitCode, logPath: r.logPath };
  },
};

/* ---------- Trivy ---------- */

interface TrivyJson {
  Results?: Array<{
    Vulnerabilities?: Array<{
      VulnerabilityID: string;
      PkgName: string;
      InstalledVersion?: string;
      FixedVersion?: string;
      Severity?: string;
      Title?: string;
    }>;
  }>;
}

export const trivy: Scanner = {
  name: "trivy",
  async scan(ctx, repoPath) {
    if (!(await recordToolVersion(ctx, "trivy", "trivy")))
      return { ok: false, unavailable: true, reason: "trivy is not installed" };
    const r = await runCommand(ctx, {
      label: "trivy-fs",
      file: "trivy",
      args: ["fs", "--scanners", "vuln", "--format", "json", "--quiet", "--skip-dirs", "node_modules", "."],
      cwd: repoPath,
      timeoutMs: 600_000,
    });
    const json = safeJson<TrivyJson>(r.stdout);
    if (!json) return { ok: false, unavailable: false, reason: "trivy produced no JSON report", ...r };
    const out: PackageVulnerability[] = [];
    for (const res of json.Results ?? [])
      for (const v of res.Vulnerabilities ?? [])
        out.push({
          packageName: v.PkgName,
          installedVersion: v.InstalledVersion,
          id: v.VulnerabilityID,
          severity: normalizeSeverity(v.Severity),
          summary: v.Title ?? v.VulnerabilityID,
          fixedIn: v.FixedVersion,
          source: "trivy",
        });
    return { ok: true, data: out, command: r.command, exitCode: r.exitCode, logPath: r.logPath };
  },
};

export const DEFAULT_SCANNERS: Scanner[] = [npmAudit, osvScanner, trivy];

/** Merges findings from several scanners, de-duplicating by package and advisory ID. */
export function dedupeVulnerabilities(vulns: PackageVulnerability[]): PackageVulnerability[] {
  const seen = new Map<string, PackageVulnerability>();
  for (const v of vulns) {
    const key = `${v.packageName}::${v.id}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, v);
    else if (!prev.source.includes(v.source)) prev.source = `${prev.source},${v.source}`;
  }
  return [...seen.values()];
}
