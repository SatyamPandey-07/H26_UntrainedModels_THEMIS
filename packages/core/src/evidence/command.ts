import { appendFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execa } from "execa";
import { scrubbedEnv } from "../config.js";
import type { RunContext } from "../run/context.js";
import { saveState } from "../run/context.js";

export interface CommandSpec {
  /** Short label used in the log file name, e.g. "npm-test". */
  label: string;
  file: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Run-relative log path, e.g. "logs/004-npm-test.log". */
  logPath: string;
  durationMs: number;
  timedOut: boolean;
}

export interface EvidenceRecord {
  seq: number;
  label: string;
  command: string;
  cwd: string;
  exitCode: number;
  logPath: string;
  durationMs: number;
  timedOut: boolean;
  at: string;
}

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shellQuote(arg: string): string {
  return SAFE_ARG.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function formatCommand(file: string, args: string[] = []): string {
  return [file, ...args].map(shellQuote).join(" ");
}

function safeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 60);
}

/**
 * Runs a process and records its exact command, exit code, duration and full output to a log file.
 * This is the only way Themis stages execute processes, so every EXECUTED claim can point at a log.
 */
export async function runCommand(ctx: RunContext, spec: CommandSpec): Promise<CommandResult> {
  ctx.seq += 1;
  const seq = ctx.seq;
  const command = formatCommand(spec.file, spec.args);
  const logFile = join(ctx.logsDir, `${String(seq).padStart(3, "0")}-${safeLabel(spec.label)}.log`);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const proc = await execa(spec.file, spec.args ?? [], {
    cwd: spec.cwd,
    env: scrubbedEnv(spec.env),
    extendEnv: false,
    reject: false,
    all: true,
    stripFinalNewline: false,
    timeout: spec.timeoutMs ?? 10 * 60_000,
    ...(spec.input !== undefined ? { input: spec.input } : { stdin: "ignore" as const }),
    maxBuffer: 64 * 1024 * 1024,
  });

  const durationMs = Date.now() - started;
  const exitCode = typeof proc.exitCode === "number" ? proc.exitCode : proc.timedOut ? 124 : 1;
  const stdout = String(proc.stdout ?? "");
  const stderr = String(proc.stderr ?? "");
  const all = String(proc.all ?? stdout + stderr);
  const failure =
    proc.failed && proc.exitCode === undefined ? `\n[spawn error] ${proc.shortMessage ?? ""}\n` : "";

  writeFileSync(
    logFile,
    [
      `# command: ${command}`,
      `# cwd: ${spec.cwd}`,
      `# started: ${startedAt}`,
      "",
      all + failure,
      "",
      `# exit code: ${exitCode}${proc.timedOut ? " (timed out)" : ""}`,
      `# duration: ${durationMs} ms`,
      "",
    ].join("\n"),
  );

  const logPath = relative(ctx.runDir, logFile);
  const record: EvidenceRecord = {
    seq,
    label: spec.label,
    command,
    cwd: spec.cwd,
    exitCode,
    logPath,
    durationMs,
    timedOut: Boolean(proc.timedOut),
    at: startedAt,
  };
  appendFileSync(join(ctx.runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  saveState(ctx);

  return {
    command,
    exitCode,
    stdout,
    stderr: stderr + failure,
    logPath,
    durationMs,
    timedOut: Boolean(proc.timedOut),
  };
}

/** Records a tool's version once per run (reproducibility requirement). */
export async function recordToolVersion(
  ctx: RunContext,
  name: string,
  file: string,
  args = ["--version"],
): Promise<string | undefined> {
  if (ctx.toolVersions[name]) return ctx.toolVersions[name];
  try {
    const proc = await execa(file, args, {
      reject: false,
      timeout: 30_000,
      env: scrubbedEnv(),
      extendEnv: false,
    });
    const version = String(proc.stdout || proc.stderr)
      .split("\n")[0]
      ?.trim();
    if (proc.exitCode === 0 && version) {
      ctx.toolVersions[name] = version;
      saveState(ctx);
      return version;
    }
  } catch {
    // tool missing: caller decides how to report it
  }
  return undefined;
}
