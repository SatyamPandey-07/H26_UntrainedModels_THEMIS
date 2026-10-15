import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordToolVersion, runCommand } from "../../evidence/command.js";
import type { CommandResult } from "../../evidence/command.js";
import type { DependencyChange, EditContext, EditOutcome } from "../types.js";
import { normalizePythonName } from "./names.js";
import { pypiRegistryInfo, releaseHashes } from "./registry.js";
import type { RequirementEntry } from "./requirements.js";
import { isDevRequirementsFile, readRequirements } from "./requirements.js";

/** Records the working-tree change as a real command so the claim has a log to point at. */
async function recordDiff(e: EditContext, files: string[]): Promise<CommandResult> {
  await runCommand(e.ctx, {
    label: "git-intent-to-add",
    file: "git",
    args: ["add", "--intent-to-add", "--", ...files],
    cwd: e.worktree,
  });
  return runCommand(e.ctx, {
    label: "requirements-diff",
    file: "git",
    args: ["diff", "--no-color", "--", ...files],
    cwd: e.worktree,
  });
}

function renderRequirement(
  name: string,
  extras: string,
  version: string,
  marker: string,
  comment: string,
  hashes: string[],
): string[] {
  const head = `${name}${extras}==${version}${marker ? ` ; ${marker}` : ""}`;
  const tail = comment ? `  ${comment}` : "";
  if (hashes.length === 0) return [`${head}${tail}`];
  return [
    `${head} \\`,
    ...hashes.map((h, i) => `    --hash=sha256:${h}${i < hashes.length - 1 ? " \\" : ""}`),
    ...(tail ? [tail.trim()] : []),
  ];
}

interface FileEdit {
  file: string;
  entries: RequirementEntry[];
  hasHashes: boolean;
}

/** Rewrites matching requirement lines in one file; returns false when nothing matched. */
async function rewriteFile(
  worktree: string,
  edit: FileEdit,
  change: DependencyChange,
  targetAlreadyListed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const abs = join(worktree, edit.file);
  const text = readFileSync(abs, "utf8");
  const crlf = text.includes("\r\n");
  const lines = text.split("\n");
  const targetName = change.strategy === "replace" ? change.target.name : undefined;
  const hashes =
    edit.hasHashes && !(change.strategy === "replace" && targetAlreadyListed)
      ? await releaseHashes(targetName ?? change.dependency, change.target.version)
      : [];
  if (edit.hasHashes && hashes.length === 0 && !(change.strategy === "replace" && targetAlreadyListed))
    return {
      ok: false,
      error: `${edit.file} pins hashes but PyPI returned none for ${targetName ?? change.dependency}==${change.target.version}`,
    };
  // Bottom-up so earlier line numbers stay valid.
  for (const entry of [...edit.entries].sort((a, b) => b.line - a.line)) {
    const removing = change.strategy === "replace" && targetAlreadyListed;
    const replacement = removing
      ? []
      : renderRequirement(
          change.strategy === "replace" ? change.target.name : entry.rawName,
          change.strategy === "replace" ? "" : entry.extras,
          change.target.version,
          entry.marker,
          entry.comment,
          hashes,
        );
    lines.splice(
      entry.line - 1,
      entry.endLine - entry.line + 1,
      ...replacement.map((l) => (crlf ? `${l}\r` : l)),
    );
  }
  writeFileSync(abs, lines.join("\n"));
  return { ok: true };
}

/**
 * Changes one dependency across the worktree's requirements files. A pip-compile generated file is changed
 * through its `.in` source and regenerated; every other file is edited in place. No package is installed here:
 * installation happens (and is judged) in the sandbox.
 */
export async function applyPythonDependencyChange(
  e: EditContext,
  change: DependencyChange,
): Promise<EditOutcome> {
  const wanted = normalizePythonName(change.dependency);
  const graph = readRequirements(e.worktree);
  const listedTarget = (file: string) =>
    graph.entries.some((x) => x.file === file && x.name === normalizePythonName(change.target.name));
  const byFile = new Map<string, FileEdit>();
  for (const f of graph.files) {
    const entries = f.entries.filter((x) => x.name === wanted);
    if (entries.length > 0) byFile.set(f.path, { file: f.path, entries, hasHashes: f.hasHashes });
  }
  if (byFile.size === 0)
    return { ok: false, files: [], error: `${change.dependency} is not listed in any requirements file` };

  const changed = new Set<string>();
  const regenerate: Array<{ input: string; output: string; hashes: boolean }> = [];
  for (const edit of byFile.values()) {
    const parsed = graph.files.find((f) => f.path === edit.file);
    const source = edit.file.replace(/\.txt$/, ".in");
    const sourceParsed = parsed?.pipCompiled && existsSync(join(e.worktree, source));
    if (sourceParsed) {
      const src = readRequirements(e.worktree).files.find((f) => f.path === source);
      const inEntries = (src?.entries ?? []).filter((x) => x.name === wanted);
      if (inEntries.length > 0) {
        const r = await rewriteFile(
          e.worktree,
          { file: source, entries: inEntries, hasHashes: false },
          change,
          src?.entries.some((x) => x.name === normalizePythonName(change.target.name)) ?? false,
        );
        if (!r.ok) return { ok: false, files: [], error: r.error };
        changed.add(source);
        regenerate.push({ input: source, output: edit.file, hashes: edit.hasHashes });
        continue;
      }
    }
    const r = await rewriteFile(e.worktree, edit, change, listedTarget(edit.file));
    if (!r.ok) return { ok: false, files: [], error: r.error };
    changed.add(edit.file);
    if (sourceParsed)
      e.book.unverified(
        "gaps",
        `${change.dependency} is only a transitive pin in ${edit.file}; it was edited in place and other pins may be stale`,
        "not listed in the pip-compile input file",
      );
  }

  for (const job of regenerate) {
    const uv = await recordToolVersion(e.ctx, "uv", "uv");
    const compile = uv
      ? {
          file: "uv",
          args: [
            "pip",
            "compile",
            job.input,
            "-o",
            job.output,
            "--upgrade-package",
            change.strategy === "replace" ? change.target.name : change.dependency,
            ...(job.hashes ? ["--generate-hashes"] : []),
          ],
        }
      : (await recordToolVersion(e.ctx, "pip-compile", "pip-compile"))
        ? {
            file: "pip-compile",
            args: [
              job.input,
              "-o",
              job.output,
              "--upgrade-package",
              change.strategy === "replace" ? change.target.name : change.dependency,
              ...(job.hashes ? ["--generate-hashes"] : []),
            ],
          }
        : undefined;
    if (!compile) {
      e.book.unverified(
        "gaps",
        `${job.output} is generated from ${job.input} but neither uv nor pip-compile is installed; the pinned file was not regenerated`,
        "pip-compile tooling unavailable",
      );
      changed.add(job.input);
      continue;
    }
    const r = await runCommand(e.ctx, {
      label: "pip-compile",
      file: compile.file,
      args: compile.args,
      cwd: e.worktree,
      timeoutMs: 600_000,
    });
    if (r.exitCode !== 0)
      return { ok: false, files: [...changed], error: `regenerating ${job.output} failed; see ${r.logPath}` };
    changed.add(job.output);
    e.book.executed("proposed-changes", `Regenerated \`${job.output}\` from \`${job.input}\``, r);
  }

  const files = [...changed];
  const diff = await recordDiff(e, files);
  const what =
    change.strategy === "replace"
      ? `Replaced \`${change.dependency}\` with \`${change.target.name}==${change.target.version}\``
      : `Pinned \`${change.dependency}==${change.target.version}\``;
  e.book.executed("proposed-changes", `${what} in ${files.map((f) => `\`${f}\``).join(", ")}`, diff);
  return { ok: true, files };
}

const RUFF_TOML = `# Minimal configuration added by Themis because the project had no linter configuration.
extend-exclude = [".venv", "venv", ".tox", "build", "dist", ".themis"]

[lint]
select = ["E4", "E7", "E9", "F"]
`;

/** Adds a minimal ruff config and a pinned ruff dev requirement (separate commit, like the ESLint concern). */
export async function proposePythonLintConfig(e: EditContext): Promise<EditOutcome> {
  const info = await pypiRegistryInfo("ruff");
  if (!info?.latestVersion) {
    e.book.unverified("gaps", "Could not look up ruff on PyPI; lint config skipped", "PyPI lookup failed");
    return { ok: false, files: [] };
  }
  writeFileSync(join(e.worktree, "ruff.toml"), RUFF_TOML);
  const devFile =
    (e.toolchain.requirementsFiles ?? []).find((f) => isDevRequirementsFile(f)) ?? "requirements-dev.txt";
  const abs = join(e.worktree, devFile);
  const existing = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(abs, `${existing}${sep}ruff==${info.latestVersion}\n`);
  const files = ["ruff.toml", devFile];
  const diff = await recordDiff(e, files);
  e.book.executed(
    "proposed-changes",
    `Added a minimal ruff configuration and pinned \`ruff==${info.latestVersion}\` in \`${devFile}\``,
    diff,
  );
  return { ok: true, files };
}
