import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { AgentTool } from "./base.js";
import { defineTool } from "./base.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".themis",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".pytest_cache",
  "site-packages",
]);
const MAX_FILE_BYTES = 200_000;

/** Resolves a model-supplied path inside `root`, refusing anything that escapes it. */
export function containedPath(root: string, path: string): string {
  const abs = resolve(root, normalize(path));
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes the repository: ${path}`);
  const first = rel.split(sep)[0] ?? "";
  if (IGNORED_DIRS.has(first)) throw new Error(`access to ${first}/ is not allowed`);
  return abs;
}

export function listFiles(root: string, dir = ".", limit = 400): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    if (out.length >= limit) return;
    for (const entry of readdirSync(abs).sort()) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(abs, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(relative(root, full));
      if (out.length >= limit) return;
    }
  };
  walk(containedPath(root, dir));
  return out;
}

function numbered(text: string, start = 1): string {
  return text
    .split("\n")
    .map((line, i) => `${i + start}|${line}`)
    .join("\n");
}

export function readOnlyTools(root: string): AgentTool<unknown>[] {
  return [
    defineTool({
      name: "list_files",
      description:
        "List repository files (relative paths) under a directory. Skips node_modules, .git, dist, build, coverage, virtualenvs.",
      parameters: z.object({ dir: z.string().default(".") }),
      handler: ({ dir }) => listFiles(root, dir).join("\n") || "(no files)",
    }),
    defineTool({
      name: "read_file",
      description:
        "Read a repository file with line numbers. Returns at most 150 lines per call; pass start_line and end_line to read further.",
      parameters: z.object({
        path: z.string(),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
      }),
      handler: ({ path, start_line, end_line }) => {
        const abs = containedPath(root, path);
        if (!existsSync(abs)) throw new Error(`file not found: ${path}`);
        if (statSync(abs).size > MAX_FILE_BYTES) throw new Error(`file too large to read: ${path}`);
        const lines = readFileSync(abs, "utf8").split("\n");
        const start = start_line ?? 1;
        const end = Math.min(end_line ?? start + 149, lines.length, start + 149);
        return numbered(lines.slice(start - 1, end).join("\n"), start);
      },
    }),
    defineTool({
      name: "search_text",
      description: "Search repository files for a literal string. Returns file:line: text matches (max 100).",
      parameters: z.object({ query: z.string().min(1) }),
      handler: ({ query }) => {
        const hits: string[] = [];
        for (const file of listFiles(root, ".", 2000)) {
          const abs = join(root, file);
          if (statSync(abs).size > MAX_FILE_BYTES) continue;
          const lines = readFileSync(abs, "utf8").split("\n");
          lines.forEach((line, i) => {
            if (hits.length < 100 && line.includes(query)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
          });
        }
        return hits.join("\n") || "(no matches)";
      },
    }),
  ];
}

/**
 * Edit tools for the Migrator. `allowed` limits writes to the files named by the current concern;
 * every write is reported through `onWrite` so the engine can stage exactly those files.
 */
export function editTools(
  root: string,
  allowed: (path: string) => boolean,
  onWrite: (rel: string) => void,
): AgentTool<unknown>[] {
  const guard = (path: string) => {
    const abs = containedPath(root, path);
    const rel = relative(root, abs);
    if (!allowed(rel)) throw new Error(`writing ${rel} is outside this concern's files`);
    return { abs, rel };
  };
  return [
    defineTool({
      name: "replace_in_file",
      description:
        "Replace one exact, unique occurrence of `search` with `replace` in a file. Fails if `search` is missing or appears more than once.",
      parameters: z.object({ path: z.string(), search: z.string().min(1), replace: z.string() }),
      handler: ({ path, search, replace }) => {
        const { abs, rel } = guard(path);
        if (!existsSync(abs)) throw new Error(`file not found: ${path}`);
        const text = readFileSync(abs, "utf8");
        const count = text.split(search).length - 1;
        if (count === 0) throw new Error("search text not found; read the file again and copy it exactly");
        if (count > 1) throw new Error(`search text appears ${count} times; include more surrounding lines`);
        writeFileSync(
          abs,
          text.replace(search, () => replace),
        );
        onWrite(rel);
        return `Edited ${rel}.`;
      },
    }),
    defineTool({
      name: "write_file",
      description:
        "Create or overwrite a file with the given content. Use for new test files or small files only.",
      parameters: z.object({ path: z.string(), content: z.string() }),
      handler: ({ path, content }) => {
        const { abs, rel } = guard(path);
        if (existsSync(abs) && readFileSync(abs, "utf8").split("\n").length > 200)
          throw new Error("file is over 200 lines; use replace_in_file");
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
        onWrite(rel);
        return `Wrote ${rel}.`;
      },
    }),
  ];
}
