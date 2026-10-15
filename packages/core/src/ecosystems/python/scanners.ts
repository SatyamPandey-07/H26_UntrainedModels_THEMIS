import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordToolVersion, runCommand } from "../../evidence/command.js";
import { safeJson } from "../../util/misc.js";
import type { PackageVulnerability, Scanner, ToolOutcome } from "../../tools/types.js";
import { normalizePythonName } from "./names.js";
import { discoverRequirementsFiles, pinnedVersion, readRequirements } from "./requirements.js";

function severity(value: unknown): string {
  const s = String(value ?? "").toLowerCase();
  if (s.startsWith("crit")) return "critical";
  if (s.startsWith("high")) return "high";
  if (s.startsWith("mod") || s.startsWith("med")) return "moderate";
  if (s.startsWith("low")) return "low";
  return "unknown";
}

/* ---------- pip-audit (OSV-backed, never installs or imports project code) ---------- */

interface PipAuditJson {
  dependencies?: Array<{
    name: string;
    version?: string;
    vulns?: Array<{ id: string; fix_versions?: string[]; aliases?: string[]; description?: string }>;
  }>;
}

export const pipAudit: Scanner = {
  name: "pip-audit",
  async scan(ctx, repoPath): Promise<ToolOutcome<PackageVulnerability[]>> {
    const graph = readRequirements(repoPath);
    const pins = new Map<string, string>();
    for (const e of graph.entries) {
      const v = pinnedVersion(e.specifier);
      if (v) pins.set(e.rawName, v);
    }
    if (pins.size === 0)
      return { ok: false, unavailable: true, reason: "pip-audit needs exact pins (name==version)" };
    if (!(await recordToolVersion(ctx, "pip-audit", "pip-audit")))
      return { ok: false, unavailable: true, reason: "pip-audit is not installed" };
    // Only exact pins are audited, so unpinned lines cannot make pip-audit refuse the whole file.
    const dir = join(ctx.runDir, "inputs");
    mkdirSync(dir, { recursive: true });
    const input = join(dir, `pinned-requirements-${ctx.seq + 1}.txt`);
    writeFileSync(input, [...pins].map(([n, v]) => `${n}==${v}`).join("\n") + "\n");
    const r = await runCommand(ctx, {
      label: "pip-audit",
      file: "pip-audit",
      args: ["-r", input, "--no-deps", "--disable-pip", "--format", "json", "--progress-spinner", "off"],
      cwd: repoPath,
      timeoutMs: 300_000,
    });
    const json = safeJson<PipAuditJson>(r.stdout);
    if (!json?.dependencies)
      return { ok: false, unavailable: false, reason: "pip-audit produced no JSON report", ...r };
    const out: PackageVulnerability[] = [];
    for (const dep of json.dependencies)
      for (const v of dep.vulns ?? []) {
        const all = [v.id, ...(v.aliases ?? [])];
        out.push({
          packageName: normalizePythonName(dep.name),
          installedVersion: dep.version,
          id: all.find((a) => a.startsWith("GHSA")) ?? all.find((a) => a.startsWith("CVE")) ?? v.id,
          severity: "unknown",
          summary: (v.description ?? v.id).split("\n")[0]!.slice(0, 200),
          fixedIn: v.fix_versions?.[0],
          source: "pip-audit",
        });
      }
    return { ok: true, data: out, command: r.command, exitCode: r.exitCode, logPath: r.logPath };
  },
};

/* ---------- OSV-Scanner on requirements files ---------- */

interface OsvJson {
  results?: Array<{
    packages?: Array<{
      package: { name: string; version?: string };
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

export const pythonOsvScanner: Scanner = {
  name: "osv-scanner",
  async scan(ctx, repoPath) {
    if (!(await recordToolVersion(ctx, "osv-scanner", "osv-scanner")))
      return { ok: false, unavailable: true, reason: "osv-scanner is not installed" };
    const files = discoverRequirementsFiles(repoPath).filter((f) => existsSync(join(repoPath, f)));
    if (files.length === 0)
      return { ok: false, unavailable: true, reason: "no requirements file for osv-scanner" };
    const r = await runCommand(ctx, {
      label: "osv-scanner",
      file: "osv-scanner",
      args: [
        "scan",
        "source",
        "--format",
        "json",
        ...files.flatMap((f) => ["--lockfile", `requirements.txt:${f}`]),
      ],
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
          const all = [v.id, ...(v.aliases ?? [])];
          out.push({
            packageName: normalizePythonName(p.package.name),
            installedVersion: p.package.version,
            id: all.find((a) => a.startsWith("GHSA")) ?? all.find((a) => a.startsWith("CVE")) ?? v.id,
            severity: severity(v.database_specific?.severity),
            summary: v.summary ?? v.id,
            fixedIn: fixed,
            source: "osv-scanner",
          });
        }
    return { ok: true, data: out, command: r.command, exitCode: r.exitCode, logPath: r.logPath };
  },
};

/* ---------- Trivy (filesystem scan; skips virtualenvs) ---------- */

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

export const pythonTrivy: Scanner = {
  name: "trivy",
  async scan(ctx, repoPath) {
    if (!(await recordToolVersion(ctx, "trivy", "trivy")))
      return { ok: false, unavailable: true, reason: "trivy is not installed" };
    const r = await runCommand(ctx, {
      label: "trivy-fs",
      file: "trivy",
      args: [
        "fs",
        "--scanners",
        "vuln",
        "--format",
        "json",
        "--quiet",
        "--skip-dirs",
        ".venv,venv,node_modules,__pycache__,.tox,.themis",
        ".",
      ],
      cwd: repoPath,
      timeoutMs: 600_000,
    });
    const json = safeJson<TrivyJson>(r.stdout);
    if (!json) return { ok: false, unavailable: false, reason: "trivy produced no JSON report", ...r };
    const out: PackageVulnerability[] = [];
    for (const res of json.Results ?? [])
      for (const v of res.Vulnerabilities ?? [])
        out.push({
          packageName: normalizePythonName(v.PkgName),
          installedVersion: v.InstalledVersion,
          id: v.VulnerabilityID,
          severity: severity(v.Severity),
          summary: v.Title ?? v.VulnerabilityID,
          fixedIn: v.FixedVersion,
          source: "trivy",
        });
    return { ok: true, data: out, command: r.command, exitCode: r.exitCode, logPath: r.logPath };
  },
};

export const PYTHON_SCANNERS: Scanner[] = [pipAudit, pythonOsvScanner, pythonTrivy];
