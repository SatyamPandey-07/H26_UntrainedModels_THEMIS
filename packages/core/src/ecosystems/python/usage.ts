import { readFileSync } from "node:fs";
import type { UsageSite } from "../../schema/stages.js";
import { dedupeSites } from "../../tools/opengrep.js";
import { slugify } from "../../util/misc.js";
import type { RuleFile } from "../types.js";
import { importNames } from "./names.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opengrep import rule for a distribution. Regex based, because dotted `import a.b` forms vary too much. */
export function pythonImportRule(dist: string): RuleFile {
  const names = importNames(dist).map(escapeRe).join("|");
  return {
    rules: [
      {
        id: `themis-${slugify(dist)}-import`,
        languages: ["python"],
        severity: "INFO",
        message: `imports ${dist}`,
        metadata: { "themis-kind": "usage" },
        paths: {
          exclude: [".venv", "venv", "__pycache__", ".tox", "site-packages", "build", "dist", ".themis"],
        },
        "pattern-regex": `(?m)^[ \\t]*(?:import|from)[ \\t]+(?:${names})(?:\\.[\\w.]+)?(?=[ \\t,]|$)`,
      },
    ],
  };
}

/** Joins `from x import (a,\n b)` blocks so one logical import is one string, remembering its first line. */
function logicalLines(text: string): Array<{ line: number; text: string }> {
  const physical = text.split("\n");
  const out: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < physical.length; i++) {
    let cur = physical[i] ?? "";
    const start = i;
    if (/^\s*from\s+\S+\s+import\s*\(/.test(cur) && !cur.includes(")")) {
      while (i + 1 < physical.length && !cur.includes(")")) cur += " " + (physical[++i] ?? "").trim();
    }
    out.push({ line: start + 1, text: cur });
  }
  return out;
}

/** Fallback mapper when Opengrep is unavailable: import lines plus calls through the imported bindings. */
export function pythonRegexUsageMap(repoPath: string, files: string[], dist: string): UsageSite[] {
  const names = importNames(dist);
  const top = new Set(names.map((n) => n.split(".")[0] as string));
  const sites: UsageSite[] = [];
  for (const file of files) {
    if (!/\.pyi?$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(`${repoPath}/${file}`, "utf8");
    } catch {
      continue;
    }
    if (![...top].some((n) => text.includes(n))) continue;
    const lines = logicalLines(text);
    const bindings = new Set<string>();
    const isImportLine = new Set<number>();
    for (const { line, text: src } of lines) {
      const trimmed = src.replace(/#.*$/, "").trim();
      let m = /^import\s+(.+)$/.exec(trimmed);
      if (m) {
        let hit = false;
        for (const part of (m[1] as string).split(",")) {
          const im = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
          if (!im) continue;
          const mod = im[1] as string;
          if (!top.has(mod.split(".")[0] as string)) continue;
          hit = true;
          bindings.add(im[2] ?? (mod.split(".")[0] as string));
        }
        if (hit) {
          isImportLine.add(line);
          sites.push({
            file,
            line,
            symbol: "import",
            ruleId: "regex-import",
            snippet: trimmed.slice(0, 300),
          });
        }
        continue;
      }
      m = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(trimmed);
      if (m && top.has((m[1] as string).split(".")[0] as string)) {
        isImportLine.add(line);
        sites.push({ file, line, symbol: "import", ruleId: "regex-import", snippet: trimmed.slice(0, 300) });
        for (const part of (m[2] as string).replace(/[()]/g, "").split(",")) {
          const im = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
          if (im && im[1] !== "*") bindings.add(im[2] ?? (im[1] as string));
        }
      }
    }
    for (const b of bindings) {
      const callRe = new RegExp(
        `(?<![\\w.])${escapeRe(b)}\\s*\\.\\s*(\\w+)\\s*\\(|(?<![\\w.])${escapeRe(b)}\\s*\\(`,
        "g",
      );
      for (const { line, text: src } of lines) {
        if (isImportLine.has(line)) continue;
        const code = src.replace(/#.*$/, "");
        for (const m of code.matchAll(callRe)) {
          sites.push({
            file,
            line,
            symbol: m[1] ?? b,
            ruleId: "regex-call",
            snippet: src.trim().slice(0, 300),
          });
        }
      }
    }
  }
  return dedupeSites(sites);
}
