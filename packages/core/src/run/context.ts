import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { z } from "zod";
import type { ThemisConfig } from "../config.js";
import { RunState } from "../schema/run.js";
import type { RunMode, StageName, StageStatus } from "../schema/run.js";

export interface RunContext {
  runId: string;
  runDir: string;
  logsDir: string;
  repoPath: string;
  config: ThemisConfig;
  state: RunState;
  /** Log sequence counter, shared by every command in the run. */
  seq: number;
  toolVersions: Record<string, string>;
}

const STAGES: StageName[] = ["scout", "planner", "migrator", "verifier", "capsule"];

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "run"
  );
}

export function newRunId(dependency?: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `${stamp}-${slug(dependency ?? "scan")}-${randomBytes(2).toString("hex")}`;
}

export function themisDir(repoPath: string): string {
  return join(resolve(repoPath), ".themis");
}

export function createRun(opts: {
  repoPath: string;
  repository?: string;
  mode: RunMode;
  dependency?: string;
  config: ThemisConfig;
}): RunContext {
  const repoPath = resolve(opts.repoPath);
  const runId = newRunId(opts.dependency);
  const runDir = join(themisDir(repoPath), "runs", runId);
  const logsDir = join(runDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const now = new Date().toISOString();
  const state: RunState = {
    runId,
    mode: opts.mode,
    repoPath,
    repository: opts.repository ?? basename(repoPath),
    dependency: opts.dependency,
    startedAt: now,
    attempt: 0,
    stages: Object.fromEntries(
      STAGES.map((s) => [s, { status: "pending" as StageStatus }]),
    ) as RunState["stages"],
    events: [],
  };
  const ctx: RunContext = {
    runId,
    runDir,
    logsDir,
    repoPath,
    config: opts.config,
    state,
    seq: 0,
    toolVersions: {},
  };
  saveState(ctx);
  return ctx;
}

export function loadRun(runDir: string, config: ThemisConfig): RunContext {
  const state = RunState.parse(JSON.parse(readFileSync(join(runDir, "state.json"), "utf8")));
  const toolsPath = join(runDir, "tools.json");
  const toolVersions = existsSync(toolsPath)
    ? (JSON.parse(readFileSync(toolsPath, "utf8")) as Record<string, string>)
    : {};
  const logsDir = join(runDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  return {
    runId: state.runId,
    runDir,
    logsDir,
    repoPath: state.repoPath,
    config,
    state,
    seq: 1000,
    toolVersions,
  };
}

export function saveState(ctx: RunContext): void {
  writeFileSync(join(ctx.runDir, "state.json"), JSON.stringify(ctx.state, null, 2) + "\n");
  writeFileSync(join(ctx.runDir, "tools.json"), JSON.stringify(ctx.toolVersions, null, 2) + "\n");
}

export function setStage(
  ctx: RunContext,
  stage: StageName,
  status: StageStatus,
  extra: { output?: string; error?: string } = {},
): void {
  const entry = ctx.state.stages[stage] ?? { status: "pending" };
  const now = new Date().toISOString();
  ctx.state.stages[stage] = {
    ...entry,
    status,
    ...(status === "running" ? { startedAt: now } : {}),
    ...(status === "done" || status === "failed" || status === "skipped" ? { finishedAt: now } : {}),
    ...extra,
  };
  saveState(ctx);
}

export function logEvent(ctx: RunContext, message: string): void {
  ctx.state.events.push({ at: new Date().toISOString(), message });
  saveState(ctx);
  if (process.env.THEMIS_QUIET !== "1") process.stderr.write(`[themis] ${message}\n`);
}

export function writeJson(ctx: RunContext, name: string, data: unknown): string {
  const path = join(ctx.runDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  return path;
}

export function readJson<T extends z.ZodType>(ctx: RunContext, name: string, schema: T): z.infer<T> {
  return schema.parse(JSON.parse(readFileSync(join(ctx.runDir, name), "utf8")));
}

export function hasJson(ctx: RunContext, name: string): boolean {
  return existsSync(join(ctx.runDir, name));
}

/** Resolves a run-relative log path to an absolute one. */
export function resolveRunPath(ctx: RunContext, path: string): string {
  return isAbsolute(path) ? path : join(ctx.runDir, path);
}
