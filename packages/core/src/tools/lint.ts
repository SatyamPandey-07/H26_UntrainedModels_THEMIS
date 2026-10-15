import { runCommand } from "../evidence/command.js";
import type { RunContext } from "../run/context.js";
import type { Linter, ToolOutcome } from "./types.js";

/** Counts violations from ESLint's stylish summary ("✖ 12 problems") or from file:line:col style output. */
export function countLintViolations(output: string): number {
  const summary = /(\d+)\s+problems?\b/.exec(output);
  if (summary) return Number(summary[1]);
  const lines = output
    .split("\n")
    .filter((l) => /^\s+\d+:\d+\s+(error|warning)\s/.test(l) || /:\d+:\d+:\s/.test(l));
  return lines.length;
}

/** Runs the project's own lint command through a shell and counts violations. */
export const projectLinter: Linter = {
  name: "project-lint",
  async lint(
    ctx: RunContext,
    repoPath: string,
    command: string,
  ): Promise<ToolOutcome<{ violations: number }>> {
    const r = await runCommand(ctx, {
      label: "lint",
      file: "sh",
      args: ["-c", command],
      cwd: repoPath,
      timeoutMs: 900_000,
    });
    if (r.exitCode === 127)
      return { ok: false, unavailable: true, reason: `lint command not found: ${command}`, ...r };
    return {
      ok: true,
      data: { violations: r.exitCode === 0 ? 0 : countLintViolations(r.stdout + r.stderr) },
      command: r.command,
      exitCode: r.exitCode,
      logPath: r.logPath,
    };
  },
};
