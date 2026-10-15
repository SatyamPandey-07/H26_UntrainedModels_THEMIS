import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordToolVersion, runCommand } from "../evidence/command.js";
import type { CommandResult } from "../evidence/command.js";
import type { RunContext } from "../run/context.js";
import { exportCommit } from "../tools/git.js";
import { findSkillsDir } from "../skills/loader.js";
import { parseVersion, safeJson } from "../util/misc.js";

export interface PreparedRef {
  /** Label used in log names, e.g. "baseline" or "candidate". */
  label: string;
  commit: string;
  /** Docker image tag, or the host directory for the host runner. */
  handle: string;
  install: CommandResult;
}

export interface ExecOptions {
  label: string;
  timeoutMs?: number;
  /** Host file -> path relative to the repo root, mounted read-only (e.g. characterization tests on baseline). */
  mounts?: Record<string, string>;
}

export interface ProbeRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

export interface ProbeResponse {
  method: string;
  path: string;
  status: number;
  body: string;
}

/** Builds and runs a commit in isolation. Docker in CI; a host fallback marks isolation as unverified. */
export interface Sandbox {
  readonly kind: "docker" | "host";
  readonly isolated: boolean;
  prepare(ctx: RunContext, label: string, commit: string): Promise<PreparedRef>;
  exec(ctx: RunContext, ref: PreparedRef, command: string, opts: ExecOptions): Promise<CommandResult>;
  probe(
    ctx: RunContext,
    ref: PreparedRef,
    service: { command: string; port: number },
    requests: ProbeRequest[],
  ): Promise<{ responses: ProbeResponse[]; result: CommandResult }>;
  cleanup(ctx: RunContext): Promise<void>;
}

export const SANDBOX_LIMITS = [
  "--memory",
  "2g",
  "--cpus",
  "2",
  "--pids-limit",
  "512",
  "--security-opt",
  "no-new-privileges",
  "--cap-drop",
  "ALL",
  "--read-only",
  "--tmpfs",
  "/tmp:rw,exec,size=1g",
  "-e",
  "HOME=/tmp",
  "-e",
  "TZ=UTC",
  "-e",
  "CI=true",
];

function dockerfilePath(): string {
  // skills/ and docker/ are siblings at the repository root.
  return join(dirname(findSkillsDir()), "docker", "sandbox.Dockerfile");
}

function nodeMajor(nodeVersion: string | undefined): string {
  const v = parseVersion(nodeVersion);
  return v && v[0] >= 18 ? String(v[0]) : "22";
}

/** Node script run inside a container to send probe requests; prints a JSON array of responses. */
const PROBE_SCRIPT = `
const [base, raw] = process.argv.slice(1);
const requests = JSON.parse(raw);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(base, { signal: AbortSignal.timeout(2000) }); break; } catch { await wait(1000); }
  }
  const out = [];
  for (const r of requests) {
    try {
      const res = await fetch(base + r.path, {
        method: r.method,
        headers: r.body ? { "content-type": "application/json" } : {},
        body: r.body ? JSON.stringify(r.body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      out.push({ method: r.method, path: r.path, status: res.status, body: (await res.text()).slice(0, 20000) });
    } catch (e) {
      out.push({ method: r.method, path: r.path, status: 0, body: "request failed: " + e.message });
    }
  }
  console.log("THEMIS_PROBES " + JSON.stringify(out));
})();
`;

function parseProbeOutput(stdout: string): ProbeResponse[] {
  const line = stdout.split("\n").find((l) => l.startsWith("THEMIS_PROBES "));
  return safeJson<ProbeResponse[]>(line?.slice("THEMIS_PROBES ".length) ?? "") ?? [];
}

export class DockerSandbox implements Sandbox {
  readonly kind = "docker" as const;
  readonly isolated = true;
  private images = new Set<string>();
  private networks = new Set<string>();
  private containers = new Set<string>();
  private cache = new Map<string, PreparedRef>();

  constructor(private readonly nodeVersion?: string) {}

  static async available(ctx: RunContext): Promise<boolean> {
    return Boolean(
      await recordToolVersion(ctx, "docker", "docker", ["version", "--format", "{{.Server.Version}}"]),
    );
  }

  private name(ctx: RunContext, label: string): string {
    return `themis-${ctx.runId.toLowerCase().replace(/[^a-z0-9-]/g, "")}-${label}`.slice(0, 120);
  }

  async prepare(ctx: RunContext, label: string, commit: string): Promise<PreparedRef> {
    const cached = this.cache.get(commit);
    if (cached) return { ...cached, label };
    const dir = join(tmpdir(), "themis-export", ctx.runId, `${label}-${commit.slice(0, 12)}`);
    rmSync(dir, { recursive: true, force: true });
    const exported = await exportCommit(ctx, ctx.repoPath, commit, dir);
    if (exported.exitCode !== 0) throw new Error(`could not export ${commit}; see ${exported.logPath}`);
    const tag = `${this.name(ctx, label)}:${commit.slice(0, 12)}`;
    const install = await runCommand(ctx, {
      label: `docker-build-${label}`,
      file: "docker",
      args: [
        "build",
        "--file",
        dockerfilePath(),
        "--build-arg",
        `NODE_VERSION=${nodeMajor(this.nodeVersion)}`,
        "--tag",
        tag,
        "--progress",
        "plain",
        dir,
      ],
      cwd: dir,
      timeoutMs: 30 * 60_000,
    });
    this.images.add(tag);
    const ref = { label, commit, handle: tag, install };
    if (install.exitCode === 0) this.cache.set(commit, ref);
    return ref;
  }

  async exec(ctx: RunContext, ref: PreparedRef, command: string, opts: ExecOptions): Promise<CommandResult> {
    const mounts = Object.entries(opts.mounts ?? {}).flatMap(([host, rel]) => [
      "-v",
      `${host}:/work/${rel}:ro`,
    ]);
    return runCommand(ctx, {
      label: `${ref.label}-${opts.label}`,
      file: "docker",
      args: [
        "run",
        "--rm",
        "--network",
        "none",
        ...SANDBOX_LIMITS,
        ...mounts,
        ref.handle,
        "sh",
        "-c",
        command,
      ],
      cwd: ctx.runDir,
      timeoutMs: opts.timeoutMs ?? 20 * 60_000,
    });
  }

  async probe(
    ctx: RunContext,
    ref: PreparedRef,
    service: { command: string; port: number },
    requests: ProbeRequest[],
  ) {
    // An internal network has no route to the internet; the probe client reaches the app by container name.
    const net = this.name(ctx, `${ref.label}-net`);
    const app = this.name(ctx, `${ref.label}-app`);
    await runCommand(ctx, {
      label: `${ref.label}-net-create`,
      file: "docker",
      args: ["network", "create", "--internal", net],
      cwd: ctx.runDir,
    });
    this.networks.add(net);
    await runCommand(ctx, {
      label: `${ref.label}-app-start`,
      file: "docker",
      args: [
        "run",
        "-d",
        "--name",
        app,
        "--network",
        net,
        ...SANDBOX_LIMITS,
        "-e",
        `PORT=${service.port}`,
        ref.handle,
        "sh",
        "-c",
        service.command,
      ],
      cwd: ctx.runDir,
    });
    this.containers.add(app);
    const result = await runCommand(ctx, {
      label: `${ref.label}-probes`,
      file: "docker",
      args: [
        "run",
        "--rm",
        "--network",
        net,
        ...SANDBOX_LIMITS,
        ref.handle,
        "node",
        "-e",
        PROBE_SCRIPT,
        `http://${app}:${service.port}`,
        JSON.stringify(requests),
      ],
      cwd: ctx.runDir,
      timeoutMs: 5 * 60_000,
    });
    await runCommand(ctx, {
      label: `${ref.label}-app-logs`,
      file: "docker",
      args: ["logs", app],
      cwd: ctx.runDir,
    });
    return { responses: parseProbeOutput(result.stdout), result };
  }

  async cleanup(ctx: RunContext): Promise<void> {
    for (const c of this.containers)
      await runCommand(ctx, { label: "docker-rm", file: "docker", args: ["rm", "-f", c], cwd: ctx.runDir });
    for (const n of this.networks)
      await runCommand(ctx, {
        label: "docker-network-rm",
        file: "docker",
        args: ["network", "rm", n],
        cwd: ctx.runDir,
      });
    for (const i of this.images)
      await runCommand(ctx, { label: "docker-rmi", file: "docker", args: ["rmi", "-f", i], cwd: ctx.runDir });
    this.containers.clear();
    this.networks.clear();
    this.images.clear();
    this.cache.clear();
    rmSync(join(tmpdir(), "themis-export", ctx.runId), { recursive: true, force: true });
  }
}

/**
 * Host fallback for developer machines without Docker (plugin mode). Same commands, same evidence,
 * but no network cut or resource limits, so the capsule marks isolation as UNVERIFIED.
 */
export class HostSandbox implements Sandbox {
  readonly kind = "host" as const;
  readonly isolated = false;
  private dirs = new Set<string>();
  private cache = new Map<string, PreparedRef>();

  async prepare(ctx: RunContext, label: string, commit: string): Promise<PreparedRef> {
    const cached = this.cache.get(commit);
    if (cached) return { ...cached, label };
    const dir = join(tmpdir(), "themis-host", ctx.runId, `${label}-${commit.slice(0, 12)}`);
    rmSync(dir, { recursive: true, force: true });
    await exportCommit(ctx, ctx.repoPath, commit, dir);
    this.dirs.add(dir);
    const installCmd = existsSync(join(dir, "pnpm-lock.yaml"))
      ? "corepack enable && pnpm install --frozen-lockfile"
      : existsSync(join(dir, "package-lock.json"))
        ? "npm ci"
        : "npm install";
    const install = await runCommand(ctx, {
      label: `host-install-${label}`,
      file: "sh",
      args: ["-c", installCmd],
      cwd: dir,
      env: { CI: "true", HUSKY: "0", TZ: "UTC" },
      timeoutMs: 30 * 60_000,
    });
    const ref = { label, commit, handle: dir, install };
    if (install.exitCode === 0) this.cache.set(commit, ref);
    return ref;
  }

  async exec(ctx: RunContext, ref: PreparedRef, command: string, opts: ExecOptions): Promise<CommandResult> {
    for (const [host, rel] of Object.entries(opts.mounts ?? {})) {
      const dest = join(ref.handle, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(host, dest);
    }
    try {
      return await runCommand(ctx, {
        label: `${ref.label}-${opts.label}`,
        file: "sh",
        args: ["-c", command],
        cwd: ref.handle,
        env: { CI: "true", TZ: "UTC", HUSKY: "0" },
        timeoutMs: opts.timeoutMs ?? 20 * 60_000,
      });
    } finally {
      for (const rel of Object.values(opts.mounts ?? {})) rmSync(join(ref.handle, rel), { force: true });
    }
  }

  async probe(
    ctx: RunContext,
    ref: PreparedRef,
    _service: { command: string; port: number },
    _requests: ProbeRequest[],
  ) {
    const result = await runCommand(ctx, {
      label: `${ref.label}-probes-skipped`,
      file: "sh",
      args: ["-c", "echo 'black-box probes need the Docker sandbox; skipped on the host runner'"],
      cwd: ref.handle,
    });
    return { responses: [] as ProbeResponse[], result };
  }

  async cleanup(_ctx: RunContext): Promise<void> {
    for (const d of this.dirs) rmSync(d, { recursive: true, force: true });
    this.dirs.clear();
    this.cache.clear();
  }
}

/** Docker when the daemon answers; otherwise the host runner (never silently in CI). */
export async function createSandbox(ctx: RunContext, nodeVersion?: string): Promise<Sandbox> {
  if (await DockerSandbox.available(ctx)) return new DockerSandbox(nodeVersion);
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")
    throw new Error("Docker is required in CI but the daemon is not reachable");
  return new HostSandbox();
}
