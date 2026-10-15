import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ClaimBook } from "../evidence/claims.js";
import { runCommand } from "../evidence/command.js";
import type { LlmClient } from "../llm/client.js";
import type { RunContext } from "../run/context.js";
import { logEvent, writeJson } from "../run/context.js";
import type {
  DependencyFinding,
  Findings,
  RiskIndicators,
  Toolchain,
  Vulnerability,
} from "../schema/stages.js";
import { Findings as FindingsSchema, Toolchain as ToolchainSchema } from "../schema/stages.js";
import { skillPath } from "../skills/loader.js";
import type { Ecosystem } from "../ecosystems/types.js";
import { detectEcosystem, hasPythonManifest } from "../ecosystems/index.js";
import { discoverRequirementsFiles } from "../ecosystems/python/requirements.js";
import type { RegistryInfo } from "../tools/registry.js";
import { dedupeVulnerabilities } from "../tools/scanners.js";
import type { PackageVulnerability } from "../tools/types.js";
import { currentBranch, headCommit } from "../tools/git.js";
import { daysSince, majorsBehind, mapLimit, safeJson } from "../util/misc.js";
import { runAgent } from "./base.js";

const SEVERITY_POINTS: Record<string, number> = { critical: 30, high: 20, moderate: 10, low: 4, unknown: 6 };

/** Deterministic risk score; mirrors skills/dependency-risk-rank/references/scoring.md. */
export function riskScore(risk: RiskIndicators, installed?: string): number {
  const vulnPoints = Math.min(
    50,
    risk.vulnerabilities.reduce((sum, v) => sum + (SEVERITY_POINTS[v.severity] ?? 6), 0),
  );
  const deprecated = risk.deprecated ? 25 : 0;
  const age = risk.ageDays ?? 0;
  const agePoints = age > 1095 ? 15 : age > 730 ? 10 : age > 365 ? 5 : 0;
  const maint = risk.maintainers === undefined || risk.maintainers === 0 ? 3 : risk.maintainers === 1 ? 5 : 0;
  const majors = Math.min(10, 5 * majorsBehind(installed, risk.latestVersion));
  const transitive = Math.min(10, risk.transitiveCount / 10);
  return Math.min(
    100,
    Math.round((vulnPoints + deprecated + agePoints + maint + majors + transitive) * 10) / 10,
  );
}

interface DetectOutput extends Partial<Toolchain> {
  entry?: string;
  sources?: Record<string, string>;
}

async function detectToolchain(
  ctx: RunContext,
  repoPath: string,
  book: ClaimBook,
  eco: Ecosystem,
): Promise<Toolchain> {
  const r = await runCommand(ctx, {
    label: "toolchain-detect",
    file: process.execPath,
    args: [skillPath("toolchain-detect", eco.detectScript), repoPath],
    cwd: repoPath,
    timeoutMs: 60_000,
  });
  const raw = safeJson<DetectOutput>(r.stdout);
  if (r.exitCode !== 0 || !raw)
    throw new Error(`toolchain detection failed (${r.stderr.trim() || "no output"}); see ${r.logPath}`);
  const { sources = {}, entry: _entry, ...fields } = raw;
  const toolchain = ToolchainSchema.parse(fields);
  const cite = (key: string) => ({ file: sources[key] ?? eco.labels.manifest });
  book.observed("dependency-details", `Language: ${toolchain.language}`, cite("language"));
  book.observed("dependency-details", `Package manager: ${toolchain.packageManager}`, cite("packageManager"));
  if (toolchain.nodeVersion)
    book.observed("dependency-details", `Node version: ${toolchain.nodeVersion}`, cite("nodeVersion"));
  if (toolchain.pythonVersion)
    book.observed("dependency-details", `Python version: ${toolchain.pythonVersion}`, cite("pythonVersion"));
  if (toolchain.testCommand)
    book.observed(
      "dependency-details",
      `Test command: \`${toolchain.testCommand}\` (${toolchain.testRunner ?? "unknown runner"})`,
      cite("testCommand"),
    );
  else
    book.unverified(
      "gaps",
      "No test command found; behaviour can only be checked with generated tests and probes.",
      eco.labels.noTestReason,
    );
  if (toolchain.linters.length > 0)
    book.observed("dependency-details", `Linters: ${toolchain.linters.join(", ")}`, cite("linters"));
  else book.unverified("gaps", eco.labels.noLinterGap, eco.labels.noLinterReason);
  return toolchain;
}

/** Attributes vulnerabilities to direct dependencies, including ones found in their transitive tree. */
function vulnsByDirect(
  vulns: PackageVulnerability[],
  direct: Set<string>,
  parentsOf: Map<string, Set<string>>,
): Map<string, Vulnerability[]> {
  const out = new Map<string, Vulnerability[]>();
  const add = (dep: string, v: PackageVulnerability, via?: string) => {
    const list = out.get(dep) ?? [];
    if (!list.some((x) => x.id === v.id)) {
      list.push({
        id: v.id,
        severity: v.severity,
        summary: via ? `${v.summary} (via ${via})` : v.summary,
        fixedIn: v.fixedIn,
        source: v.source,
      });
    }
    out.set(dep, list);
  };
  for (const v of vulns) {
    if (direct.has(v.packageName)) add(v.packageName, v);
    for (const parent of parentsOf.get(v.packageName) ?? [])
      if (parent !== v.packageName) add(parent, v, v.packageName);
  }
  return out;
}

const Rationales = z.object({
  rationales: z.array(z.object({ name: z.string(), rationale: z.string().max(400) })),
});

export interface ScoutOptions {
  /** Number of top-ranked dependencies that get registry lookups beyond the first pass and an AI rationale. */
  rationaleCount?: number;
  /** Force an ecosystem ("node" or "python"); otherwise it is detected from the repository's manifests. */
  ecosystem?: string;
}

/** Argus: toolchain detection and dependency risk ranking on the base branch. Never modifies the repository. */
export async function runScout(
  ctx: RunContext,
  llm: LlmClient | undefined,
  opts: ScoutOptions = {},
): Promise<Findings> {
  const repoPath = ctx.repoPath;
  const book = new ClaimBook("argus");
  const baseRef = await currentBranch(repoPath);
  const baseCommit = await headCommit(repoPath);
  logEvent(ctx, `argus: scanning ${ctx.state.repository} at ${baseRef} (${baseCommit.slice(0, 7)})`);

  const eco = detectEcosystem(repoPath, opts.ecosystem);
  const toolchain = await detectToolchain(ctx, repoPath, book, eco);
  const { graph, gaps: graphGaps } = await eco.readDependencyGraph(repoPath, toolchain);
  for (const gap of graphGaps)
    book.unverified("gaps", gap, "dependency manifest could not be fully resolved");
  if (eco.id === "node" && hasPythonManifest(repoPath))
    book.unverified(
      "gaps",
      `Python requirements files (${discoverRequirementsFiles(repoPath).join(", ")}) were not analysed; this run covers the Node.js project only.`,
      "one ecosystem is analysed per run",
    );
  if (eco.id === "python" && existsSync(join(repoPath, "package.json")))
    book.unverified(
      "gaps",
      "package.json was not analysed; this run covers the Python requirements only.",
      "one ecosystem is analysed per run",
    );
  book.observed(
    "dependency-details",
    `${graph.direct.length} direct dependencies (${graph.direct.filter((d) => d.dev).length} dev); tree read from ${graph.source}`,
    { file: graph.source },
  );

  // Vulnerability scanners: each one either produces an EXECUTED claim or an UNVERIFIED gap.
  const allVulns: PackageVulnerability[] = [];
  for (const scanner of eco.scanners) {
    const outcome = await scanner.scan(ctx, repoPath);
    if (outcome.ok) {
      allVulns.push(...outcome.data);
      book.executed(
        "risk-indicators",
        `${scanner.name} reported ${outcome.data.length} vulnerability record(s)`,
        outcome,
      );
    } else {
      book.unverified("gaps", `${scanner.name} did not run: ${outcome.reason}`, outcome.reason);
    }
  }
  const vulns = dedupeVulnerabilities(allVulns);
  const byDep = vulnsByDirect(vulns, new Set(graph.direct.map((d) => d.name)), graph.parentsOf);

  // Registry signals for every direct dependency.
  const registry = new Map<string, RegistryInfo | undefined>();
  await mapLimit(graph.direct, 8, async (d) => {
    registry.set(d.name, await eco.registryInfo(d.name, d.installedVersion));
  });

  const ranked: DependencyFinding[] = graph.direct.map((d) => {
    const info = registry.get(d.name);
    const risk: RiskIndicators = {
      vulnerabilities: byDep.get(d.name) ?? [],
      deprecated: Boolean(info?.deprecated),
      deprecationMessage: info?.deprecated,
      latestVersion: info?.latestVersion,
      lastPublish: info?.lastPublish,
      ageDays: daysSince(info?.lastPublish),
      maintainers: info?.maintainers,
      weeklyDownloads: info?.weeklyDownloads,
      transitiveCount: graph.transitiveCount.get(d.name) ?? 0,
    };
    const currentVersion = d.installedVersion ?? d.declaredRange.replace(/^[^\d]*/, "");
    return {
      name: d.name,
      currentVersion,
      declaredRange: d.declaredRange,
      dev: d.dev,
      score: riskScore(risk, currentVersion),
      risk,
    };
  });
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.risk.vulnerabilities.length - a.risk.vulnerabilities.length ||
      a.name.localeCompare(b.name),
  );

  const unreachable = graph.direct.filter((d) => !registry.get(d.name)).map((d) => d.name);
  if (unreachable.length > 0)
    book.unverified(
      "gaps",
      `Registry data unavailable for: ${unreachable.join(", ")}`,
      eco.labels.registryGapReason,
    );

  const top = ranked.slice(0, opts.rationaleCount ?? 8);
  for (const dep of top) {
    const info = registry.get(dep.name);
    const signals: string[] = [];
    if (dep.risk.vulnerabilities.length > 0)
      signals.push(`${dep.risk.vulnerabilities.length} known vulnerabilit(y/ies)`);
    if (dep.risk.deprecated) signals.push(`deprecated: "${dep.risk.deprecationMessage}"`);
    if (dep.risk.latestVersion)
      signals.push(`installed ${dep.currentVersion}, latest ${dep.risk.latestVersion}`);
    if (dep.risk.ageDays !== undefined) signals.push(`latest release ${dep.risk.ageDays} days ago`);
    signals.push(`${dep.risk.transitiveCount} transitive packages`);
    book.observed("risk-indicators", `\`${dep.name}\` (score ${dep.score}): ${signals.join("; ")}`, {
      url: info?.url,
    });
  }

  // The model only explains the ranking; it cannot change scores or add signals.
  if (llm && top.length > 0) {
    try {
      const result = await runAgent(ctx, llm, {
        agent: "argus",
        label: "risk-rationale",
        task: "Write a one or two sentence rationale for each dependency below, using only the signals given. Keep the given order and names.",
        data: {
          "ranked-dependencies.json": JSON.stringify(
            top.map((d) => ({
              name: d.name,
              score: d.score,
              dev: d.dev,
              currentVersion: d.currentVersion,
              risk: d.risk,
            })),
            null,
            2,
          ),
        },
        output: Rationales,
        outputDescription: "Submit one rationale per dependency name.",
        maxSteps: 4,
      });
      for (const r of result.output.rationales) {
        const dep = ranked.find((d) => d.name === r.name);
        if (!dep) continue;
        dep.rationale = r.rationale;
        book.recommended("ai-analysis", `\`${dep.name}\`: ${r.rationale}`, result.model, result.inputs);
      }
    } catch (err) {
      book.unverified(
        "unresolved",
        `Risk rationales were not generated: ${(err as Error).message}`,
        "model call failed",
      );
    }
  }

  const findings: Findings = FindingsSchema.parse({
    repoPath,
    baseRef,
    baseCommit,
    toolchain,
    dependencies: ranked,
    claims: book.claims,
  });
  writeJson(ctx, "findings.json", findings);
  logEvent(
    ctx,
    `argus: ranked ${ranked.length} dependencies; top: ${ranked
      .slice(0, 3)
      .map((d) => `${d.name} (${d.score})`)
      .join(", ")}`,
  );
  return findings;
}
