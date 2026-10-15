#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { writeCapsule } from "./capsule/writer.js";
import { loadConfig } from "./config.js";
import { recommendDependency, runThemis } from "./orchestrator.js";
import type { RunOutcome } from "./orchestrator.js";
import { hasJson, loadRun, readJson } from "./run/context.js";
import { Findings, MigrationPlan, MigrationResult, Verification } from "./schema/stages.js";
import type { DependencyFinding } from "./schema/stages.js";

function table(deps: DependencyFinding[], limit: number): string {
  const rows = deps
    .slice(0, limit)
    .map((d, i) => [
      String(i + 1),
      d.name,
      d.currentVersion,
      d.risk.latestVersion ?? "?",
      String(d.score),
      String(d.risk.vulnerabilities.length),
      d.risk.deprecated ? "yes" : "",
      d.dev ? "dev" : "",
    ]);
  const head = ["#", "dependency", "installed", "latest", "score", "vulns", "deprecated", ""];
  const widths = head.map((h, c) => Math.max(h.length, ...rows.map((r) => (r[c] ?? "").length)));
  const line = (r: string[]) =>
    r
      .map((v, c) => v.padEnd(widths[c] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

function report(outcome: RunOutcome, json: boolean): void {
  const { ctx, findings, plan, capsule, recommended, error } = outcome;
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          runId: ctx.runId,
          runDir: ctx.runDir,
          recommended: recommended?.name,
          dependencies: findings?.dependencies.map((d) => ({
            name: d.name,
            score: d.score,
            rationale: d.rationale,
          })),
          plan: plan && {
            dependency: plan.dependency,
            strategy: plan.strategy,
            target: plan.target,
            feasible: plan.feasible,
            confidence: plan.confidence,
          },
          verdict: capsule?.capsule.verdict,
          branch: capsule?.capsule.branch,
          error,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const out: string[] = [];
  if (findings && !plan) {
    out.push(table(findings.dependencies, 15));
    if (recommended)
      out.push(
        "",
        `Recommended: ${recommended.name} (score ${recommended.score})${recommended.rationale ? ` - ${recommended.rationale}` : ""}`,
      );
  }
  if (plan)
    out.push(
      `Plan: ${plan.strategy} ${plan.dependency}@${plan.fromVersion} -> ${plan.target.name}@${plan.target.version} (confidence ${plan.confidence}, feasible ${plan.feasible})`,
      `Usage sites: ${plan.usage.length}; concerns: ${plan.concerns.map((c) => c.kind).join(" -> ")}`,
    );
  if (capsule)
    out.push(
      `Verdict: ${capsule.capsule.verdict}`,
      `Branch: ${capsule.capsule.branch ?? "none"}`,
      `Capsule: ${ctx.runDir}/capsule.md`,
    );
  if (error) out.push(`Error: ${error}`);
  out.push(`Run directory: ${ctx.runDir}`);
  process.stdout.write(out.join("\n") + "\n");
}

const program = new Command()
  .name("themis")
  .description(
    "Find risky dependencies, migrate one on its own branch, verify it, and write an evidence capsule.",
  )
  .option("-C, --repo <path>", "repository to work on", ".")
  .option("--json", "print machine-readable output")
  .showHelpAfterError();

const common = () => {
  const o = program.opts<{ repo: string; json?: boolean }>();
  return { repoPath: resolve(o.repo), json: Boolean(o.json) };
};

program
  .command("scan")
  .description("rank direct dependencies by risk (read-only)")
  .action(async () => {
    const { repoPath, json } = common();
    report(await runThemis({ repoPath, mode: "scan" }), json);
  });

program
  .command("plan")
  .argument("[package]", "dependency to plan (default: the recommended one)")
  .description("map usage and write a migration plan (read-only)")
  .action(async (pkg?: string) => {
    const { repoPath, json } = common();
    report(await runThemis({ repoPath, mode: "plan", dependency: pkg }), json);
  });

program
  .command("run")
  .argument("[package]", "dependency to migrate (default: the recommended one)")
  .option("--resume <runDir>", "continue an earlier run, reusing its completed stages")
  .option("--full-tests", "run the full test suite instead of related and characterization tests")
  .description("scan, plan, migrate on a themis/* branch, verify, and write the capsule")
  .action(async (pkg: string | undefined, o: { resume?: string; fullTests?: boolean }) => {
    const { repoPath, json } = common();
    if (o.fullTests) process.env.THEMIS_FULL_TESTS = "1";
    const outcome = await runThemis({
      repoPath,
      mode: "run",
      dependency: pkg,
      resumeRunDir: o.resume ? resolve(o.resume) : undefined,
    });
    report(outcome, json);
    if (!outcome.capsule) process.exitCode = 1;
  });

program
  .command("capsule")
  .argument("<runDir>", "run directory under .themis/runs/")
  .description("rebuild capsule.md, the PR body and the check run from a run's stage outputs")
  .action(async (runDir: string) => {
    const ctx = loadRun(resolve(runDir), loadConfig(resolve(runDir)));
    const out = await writeCapsule(ctx, {
      findings: hasJson(ctx, "findings.json") ? readJson(ctx, "findings.json", Findings) : undefined,
      plan: hasJson(ctx, "plan.json") ? readJson(ctx, "plan.json", MigrationPlan) : undefined,
      migration: hasJson(ctx, "migration.json")
        ? readJson(ctx, "migration.json", MigrationResult)
        : undefined,
      verification: hasJson(ctx, "verification.json")
        ? readJson(ctx, "verification.json", Verification)
        : undefined,
      dependency: ctx.state.dependency,
    });
    process.stdout.write(`${out.capsule.verdict}\n${ctx.runDir}/capsule.md\n`);
  });

program
  .command("recommend")
  .description("print the dependency Themis would migrate next")
  .action(async () => {
    const { repoPath, json } = common();
    const outcome = await runThemis({ repoPath, mode: "scan" });
    const rec = outcome.findings ? recommendDependency(outcome.findings) : undefined;
    process.stdout.write(
      json ? JSON.stringify({ recommended: rec?.name ?? null }) + "\n" : `${rec?.name ?? "none"}\n`,
    );
  });

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`themis: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
