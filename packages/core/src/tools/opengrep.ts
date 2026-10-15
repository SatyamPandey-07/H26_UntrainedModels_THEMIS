import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { recordToolVersion, runCommand } from "../evidence/command.js";
import type { RunContext } from "../run/context.js";
import type { UsageSite } from "../schema/stages.js";
import { safeJson } from "../util/misc.js";
import type { Mapper, ToolOutcome } from "./types.js";

interface OpengrepJson {
  results?: Array<{
    check_id: string;
    path: string;
    start: { line: number };
    end: { line: number };
    extra?: { lines?: string; metavars?: Record<string, { abstract_content?: string }> };
  }>;
  errors?: Array<{ message?: string; type?: unknown; level?: string }>;
}

export async function opengrepAvailable(ctx: RunContext): Promise<boolean> {
  return Boolean(await recordToolVersion(ctx, "opengrep", "opengrep"));
}

function symbolFor(r: NonNullable<OpengrepJson["results"]>[number]): string {
  const mv = r.extra?.metavars ?? {};
  const fn = mv.$FN?.abstract_content;
  if (fn) return fn;
  if (/import|require/.test(r.check_id)) return "import";
  return mv.$M?.abstract_content ?? "call";
}

/** Runs usage rules and returns one site per match (file paths relative to the repo). */
export const opengrepMapper: Mapper = {
  name: "opengrep",
  async map(ctx, repoPath, rulesPath, excludes = []): Promise<ToolOutcome<UsageSite[]>> {
    if (!(await opengrepAvailable(ctx)))
      return { ok: false, unavailable: true, reason: "opengrep is not installed" };
    const r = await runCommand(ctx, {
      label: "opengrep-usage",
      file: "opengrep",
      args: [
        "scan",
        "--config",
        rulesPath,
        "--json",
        "--quiet",
        "--exclude",
        "node_modules",
        "--exclude",
        ".themis",
        ...excludes.flatMap((d) => ["--exclude", d]),
        ".",
      ],
      cwd: repoPath,
      timeoutMs: 600_000,
    });
    const json = safeJson<OpengrepJson>(r.stdout);
    if (!json) return { ok: false, unavailable: false, reason: "opengrep produced no JSON output", ...r };
    const fatal = (json.errors ?? []).filter((e) => e.level === "error");
    if (fatal.length > 0 && (json.results ?? []).length === 0) {
      return {
        ok: false,
        unavailable: false,
        reason: `opengrep rule errors: ${fatal
          .map((e) => e.message ?? "unknown")
          .join("; ")
          .slice(0, 2000)}`,
        ...r,
      };
    }
    const sites: UsageSite[] = (json.results ?? []).map((res) => ({
      file: relative(repoPath, `${repoPath}/${res.path}`).replace(/^\.\//, ""),
      line: res.start.line,
      endLine: res.end.line,
      symbol: symbolFor(res),
      ruleId: res.check_id.split(".").pop() ?? res.check_id,
      snippet: (res.extra?.lines ?? "").trim().slice(0, 300),
    }));
    return {
      ok: true,
      data: dedupeSites(sites),
      command: r.command,
      exitCode: r.exitCode,
      logPath: r.logPath,
    };
  },
};

/** Applies fix rules in place (Migrator autofix concern). */
export async function opengrepAutofix(
  ctx: RunContext,
  repoPath: string,
  rulesPath: string,
  excludes: string[] = [],
) {
  return runCommand(ctx, {
    label: "opengrep-autofix",
    file: "opengrep",
    args: [
      "scan",
      "--config",
      rulesPath,
      "--autofix",
      "--quiet",
      "--exclude",
      "node_modules",
      "--exclude",
      ".themis",
      ...excludes.flatMap((d) => ["--exclude", d]),
      ".",
    ],
    cwd: repoPath,
    timeoutMs: 600_000,
  });
}

export function dedupeSites(sites: UsageSite[]): UsageSite[] {
  const seen = new Map<string, UsageSite>();
  for (const s of sites) {
    const key = `${s.file}:${s.line}:${s.symbol}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Fallback mapper when opengrep is unavailable: finds import/require of a package and member calls on its binding. */
export function regexUsageMap(repoPath: string, files: string[], pkg: string): UsageSite[] {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const importRe = new RegExp(
    `(?:import\\s+(?:\\*\\s+as\\s+)?([A-Za-z_$][\\w$]*)?[^'"\\n]*from\\s*['"]${esc}(?:/[^'"]*)?['"]|(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*['"]${esc}(?:/[^'"]*)?['"]\\s*\\)|require\\(\\s*['"]${esc}(?:/[^'"]*)?['"]\\s*\\)|import\\s*['"]${esc}['"])`,
  );
  const sites: UsageSite[] = [];
  for (const file of files) {
    if (!/\.(c|m)?(j|t)sx?$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(`${repoPath}/${file}`, "utf8");
    } catch {
      continue;
    }
    if (!text.includes(pkg)) continue;
    const lines = text.split("\n");
    const bindings = new Set<string>();
    lines.forEach((line, i) => {
      const m = importRe.exec(line);
      if (!m) return;
      const name = m[1] ?? m[2];
      if (name) bindings.add(name);
      sites.push({
        file,
        line: i + 1,
        symbol: "import",
        ruleId: "regex-import",
        snippet: line.trim().slice(0, 300),
      });
    });
    for (const b of bindings) {
      const callRe = new RegExp(
        `(?<![\\w$.])${b.replace(/\$/g, "\\$")}(?:\\s*\\([^)]*\\))?\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(|(?<![\\w$.])${b.replace(/\$/g, "\\$")}\\s*\\(`,
        "g",
      );
      lines.forEach((line, i) => {
        if (importRe.test(line)) return;
        for (const m of line.matchAll(callRe)) {
          sites.push({
            file,
            line: i + 1,
            symbol: m[1] ?? b,
            ruleId: "regex-call",
            snippet: line.trim().slice(0, 300),
          });
        }
      });
    }
  }
  return dedupeSites(sites);
}
