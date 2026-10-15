import { execa } from "execa";
import { scrubbedEnv } from "../config.js";
import { runCommand } from "../evidence/command.js";
import type { RunContext } from "../run/context.js";

/** Read-only git queries that are not evidence (no log file needed). */
async function gitQuery(cwd: string, args: string[]): Promise<string> {
  const r = await execa("git", args, { cwd, reject: false, env: scrubbedEnv(), extendEnv: false });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(r.stderr).trim()}`);
  return String(r.stdout).trim();
}

export async function headCommit(cwd: string, ref = "HEAD"): Promise<string> {
  return gitQuery(cwd, ["rev-parse", ref]);
}

export async function currentBranch(cwd: string): Promise<string> {
  const name = await gitQuery(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD");
  return name === "HEAD" ? "detached" : name;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return gitQuery(cwd, ["rev-parse", "--is-inside-work-tree"]).then(
    (v) => v === "true",
    () => false,
  );
}

export async function remoteSlug(cwd: string): Promise<string | undefined> {
  const url = await gitQuery(cwd, ["remote", "get-url", "origin"]).catch(() => "");
  const m = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  return m?.[1];
}

export async function trackedFiles(cwd: string): Promise<string[]> {
  const out = await gitQuery(cwd, ["ls-files"]);
  return out.split("\n").filter(Boolean);
}

/** Last commit touching a line (who/when), used by the Planner for context. */
export async function gitBlameLine(cwd: string, file: string, line: number): Promise<string | undefined> {
  const out = await gitQuery(cwd, ["blame", "-L", `${line},${line}`, "--porcelain", "--", file]).catch(
    () => "",
  );
  const author = /^author (.*)$/m.exec(out)?.[1];
  const time = /^author-time (\d+)$/m.exec(out)?.[1];
  if (!author) return undefined;
  return `${author}, ${time ? new Date(Number(time) * 1000).toISOString().slice(0, 10) : "unknown date"}`;
}

/** Creates a worktree on a new branch from `base`. Never touches the base branch itself. */
export async function addWorktree(
  ctx: RunContext,
  repoPath: string,
  path: string,
  branch: string,
  base: string,
) {
  return runCommand(ctx, {
    label: "git-worktree-add",
    file: "git",
    args: ["worktree", "add", "-B", branch, path, base],
    cwd: repoPath,
  });
}

export async function removeWorktree(ctx: RunContext, repoPath: string, path: string) {
  return runCommand(ctx, {
    label: "git-worktree-remove",
    file: "git",
    args: ["worktree", "remove", "--force", path],
    cwd: repoPath,
  });
}

/** Stages exactly `files` and commits them; returns the new commit SHA or undefined when there was nothing to commit. */
export async function commitFiles(
  ctx: RunContext,
  cwd: string,
  files: string[],
  message: string,
): Promise<string | undefined> {
  if (files.length === 0) return undefined;
  await runCommand(ctx, { label: "git-add", file: "git", args: ["add", "--", ...files], cwd });
  const staged = await gitQuery(cwd, ["diff", "--cached", "--name-only"]);
  if (!staged) return undefined;
  const r = await runCommand(ctx, {
    label: "git-commit",
    file: "git",
    args: [
      "-c",
      "user.name=themis[bot]",
      "-c",
      "user.email=themis-bot@users.noreply.github.com",
      "commit",
      "--no-verify",
      "-m",
      message,
    ],
    cwd,
  });
  if (r.exitCode !== 0) throw new Error(`git commit failed, see ${r.logPath}`);
  return headCommit(cwd);
}

export async function changedFiles(cwd: string, base: string): Promise<string[]> {
  const out = await gitQuery(cwd, ["diff", "--name-only", `${base}...HEAD`]);
  return out.split("\n").filter(Boolean);
}

/** Exports a commit to a directory without any untracked or ignored files (sandbox input). */
export async function exportCommit(ctx: RunContext, repoPath: string, commit: string, dest: string) {
  return runCommand(ctx, {
    label: `git-archive-${commit.slice(0, 7)}`,
    file: "sh",
    args: ["-c", `mkdir -p "$1" && git archive --format=tar "$2" | tar -x -C "$1"`, "sh", dest, commit],
    cwd: repoPath,
  });
}

/** Files modified or created in a working tree (staged or not), relative to its root. */
export async function dirtyFiles(cwd: string): Promise<string[]> {
  const out = await gitQuery(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .map((p) => (p.includes(" -> ") ? (p.split(" -> ").pop() as string) : p));
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return gitQuery(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );
}
