#!/usr/bin/env node
/**
 * Publish step of the Themis runner workflow. Runs with the App installation token and never executes code
 * from the target repository: it only moves git objects and calls the GitHub API.
 *
 * Inputs (environment): GITHUB_TOKEN, TARGET_REPO (owner/name), MODE (run|scan), RESULT_JSON, RUN_DIR,
 * BUNDLE (optional), ISSUE_NUMBER (optional), RUN_URL (optional), ALERT_WEBHOOK_URL/SECRET (optional).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { Capsule, Findings, capsuleRepoPath, recommendDependency, sendAlert } from "@themis/core";
import type { CheckRunOutput } from "@themis/core";
import { readRepoConfig } from "./config.js";
import { DASHBOARD_TITLE, isDashboard, renderDashboard } from "./dashboard.js";

/** Writes a step output when running inside GitHub Actions. */
function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) writeFileSync(file, `${name}=${value}\n`, { flag: "a" });
}

interface CliResult {
  runId?: string;
  runDir?: string;
  recommended?: string;
  verdict?: string;
  branch?: string;
  error?: string;
  plan?: { dependency: string; strategy: string; target: { name: string; version: string } };
}

const LABELS: Record<string, { color: string; description: string }> = {
  themis: { color: "5319e7", description: "Opened or tracked by Themis" },
  "ai-generated": { color: "c5def5", description: "Contains AI-generated changes; review before merging" },
};

function env(name: string, required = true): string {
  const v = process.env[name]?.trim() ?? "";
  if (required && !v) throw new Error(`${name} is required`);
  return v;
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Runs git with the token passed as an HTTP header, so it is never written to disk or a remote URL. */
function git(cwd: string, token: string, args: string[]): string {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return execFileSync("git", ["-c", `http.https://github.com/.extraheader=${header}`, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
  for (const [name, meta] of Object.entries(LABELS)) {
    try {
      await octokit.issues.getLabel({ owner, repo, name });
    } catch {
      await octokit.issues.createLabel({ owner, repo, name, ...meta }).catch(() => undefined);
    }
  }
}

/** Repositories with Issues turned off have no dashboard; the run still publishes its pull request. */
async function tryDashboard(
  run: () => Promise<{ number: number; url: string }>,
): Promise<{ number: number; url: string } | undefined> {
  try {
    return await run();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 410 || status === 404) {
      console.log("issues are disabled on this repository; dashboard skipped");
      return undefined;
    }
    throw err;
  }
}

async function upsertDashboard(
  octokit: Octokit,
  owner: string,
  repo: string,
  findings: Findings,
  openPrs: Record<string, { number: number; url: string }>,
  runUrl?: string,
  recommended?: string,
): Promise<{ number: number; url: string }> {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    labels: "themis",
    per_page: 100,
  });
  const existing = issues.find((i) => !i.pull_request && isDashboard(i.body));
  const body = renderDashboard(findings, { openPrs, runUrl, recommended });
  if (existing) {
    await octokit.issues.update({ owner, repo, issue_number: existing.number, body });
    return { number: existing.number, url: existing.html_url };
  }
  const created = await octokit.issues.create({
    owner,
    repo,
    title: DASHBOARD_TITLE,
    body,
    labels: ["themis"],
  });
  return { number: created.data.number, url: created.data.html_url };
}

async function openThemisPrs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Record<string, { number: number; url: string }>> {
  const prs = await octokit.paginate(octokit.pulls.list, { owner, repo, state: "open", per_page: 100 });
  const out: Record<string, { number: number; url: string }> = {};
  for (const pr of prs) {
    const m = /^themis\/(.+)-\d{8}$/.exec(pr.head.ref);
    const dep =
      pr.labels.some((l) => l.name === "themis") && m ? (/`([^`]+)`/.exec(pr.title)?.[1] ?? m[1]) : undefined;
    if (dep) out[dep] = { number: pr.number, url: pr.html_url };
  }
  return out;
}

async function comment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issue: number | undefined,
  body: string,
) {
  if (issue) await octokit.issues.createComment({ owner, repo, issue_number: issue, body });
}

async function main(): Promise<void> {
  const token = env("GITHUB_TOKEN");
  const [owner, repo] = env("TARGET_REPO").split("/") as [string, string];
  const mode = env("MODE");
  const runDir = env("RUN_DIR", false) ? resolve(env("RUN_DIR")) : "";
  const runUrl = env("RUN_URL", false) || undefined;
  const issueNumber = Number(env("ISSUE_NUMBER", false)) || undefined;
  // Absolute, because git commands below run inside the fresh clone.
  const bundle = env("BUNDLE", false) ? resolve(env("BUNDLE")) : "";
  const result = readJsonFile<CliResult>(env("RESULT_JSON")) ?? {};
  const octokit = new Octokit({ auth: token, userAgent: "themis-publish" });
  const { data: repoInfo } = await octokit.repos.get({ owner, repo });
  await ensureLabels(octokit, owner, repo);

  const findingsRaw = runDir ? readJsonFile<unknown>(join(runDir, "findings.json")) : undefined;
  const findings = findingsRaw ? Findings.parse(findingsRaw) : undefined;

  if (!findings && !existsSync(join(runDir, "capsule.json"))) {
    await comment(
      octokit,
      owner,
      repo,
      issueNumber,
      `Themis could not complete this run${result.error ? `: ${result.error}` : "."}${runUrl ? ` See the [run log](${runUrl}).` : ""}`,
    );
    throw new Error(`pipeline produced no findings or capsule${result.error ? `: ${result.error}` : ""}`);
  }

  if (mode === "scan") {
    const { config, warning } = await readRepoConfig(octokit, owner, repo);
    const visible: Findings = {
      ...(findings as Findings),
      dependencies: (findings as Findings).dependencies.filter((d) => !config.ignore.includes(d.name)),
    };
    const recommended = recommendDependency(visible);
    const prs = await openThemisPrs(octokit, owner, repo);
    const dash = await tryDashboard(() =>
      upsertDashboard(octokit, owner, repo, visible, prs, runUrl, recommended?.name),
    );
    if (warning && dash) await comment(octokit, owner, repo, dash.number, warning);
    if (dash && issueNumber && issueNumber !== dash.number)
      await comment(
        octokit,
        owner,
        repo,
        issueNumber,
        `Scan finished. Ranked dependencies are on the [Dependency Dashboard](${dash.url}).`,
      );
    console.log(dash ? `dashboard: ${dash.url}` : "scan finished without a dashboard");

    // Automatic decision: migrate the top risky dependency, at most once per interval, within the PR limit.
    const risky = recommended && (recommended.risk.vulnerabilities.length > 0 || recommended.risk.deprecated);
    if (
      config.autoMigrate &&
      risky &&
      !prs[recommended.name] &&
      Object.keys(prs).length < config.maxOpenPrs
    ) {
      const since = Date.now() - config.autoMigrateIntervalDays * 86_400_000;
      const recent = await octokit.paginate(octokit.pulls.list, { owner, repo, state: "all", per_page: 100 });
      const autoRecently = recent.some(
        (p) => p.head.ref.startsWith("themis/") && Date.parse(p.created_at) > since,
      );
      if (!autoRecently) {
        setOutput("auto_package", recommended.name);
        if (dash) setOutput("dashboard_issue", String(dash.number));
        console.log(`auto-migrate: ${recommended.name}`);
      }
    }
    return;
  }

  const capsule = Capsule.parse(readJsonFile<unknown>(join(runDir, "capsule.json")));
  const prBody = readFileSync(join(runDir, "pr-body.md"), "utf8");
  const checkRun = readJsonFile<CheckRunOutput>(join(runDir, "check-run.json"));
  const capsuleMd = readFileSync(join(runDir, "capsule.md"), "utf8");
  const dep = capsule.dependency.name;

  if (!capsule.branch || !bundle || !existsSync(bundle)) {
    // Nothing to push (for example "Not recommended"): publish the capsule where people will see it.
    const body = `## Themis: ${capsule.verdict} for \`${dep}\`\n\n${capsuleMd.slice(0, 60_000)}${runUrl ? `\n\n[Run log](${runUrl})` : ""}`;
    if (issueNumber) await comment(octokit, owner, repo, issueNumber, body);
    else
      await octokit.issues.create({
        owner,
        repo,
        title: `Themis: ${capsule.verdict} for ${dep}`,
        body,
        labels: ["themis"],
      });
    console.log(`verdict without branch: ${capsule.verdict}`);
    return;
  }

  // Push the Themis branch from the pipeline's bundle and add the capsule to it.
  const work = mkdtempSync(join(tmpdir(), "themis-publish-"));
  git(work, token, [
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    `https://github.com/${owner}/${repo}.git`,
    "repo",
  ]);
  const dir = join(work, "repo");
  git(dir, token, ["fetch", bundle, `+refs/heads/${capsule.branch}:refs/heads/${capsule.branch}`]);
  git(dir, token, ["checkout", capsule.branch]);
  const capsulePath = capsuleRepoPath(dep);
  mkdirSync(dirname(join(dir, capsulePath)), { recursive: true });
  writeFileSync(join(dir, capsulePath), capsuleMd);
  writeFileSync(join(dir, capsulePath.replace(/\.md$/, ".json")), JSON.stringify(capsule, null, 2) + "\n");
  git(dir, token, ["add", dirname(capsulePath)]);
  git(dir, token, [
    "-c",
    "user.name=themis[bot]",
    "-c",
    "user.email=themis-bot@users.noreply.github.com",
    "commit",
    "--no-verify",
    "-m",
    `themis(capsule): Dependency Exit Capsule for ${dep}`,
  ]);
  git(dir, token, ["push", "--force", "origin", `refs/heads/${capsule.branch}:refs/heads/${capsule.branch}`]);
  const headSha = git(dir, token, ["rev-parse", "HEAD"]);

  // Draft PR (reuse an open one for the same branch).
  const title = `Themis: ${capsule.dependency.strategy === "replace" ? "replace" : "upgrade"} \`${dep}\` → ${capsule.dependency.to ?? "?"} (${capsule.verdict})`;
  const existing = (
    await octokit.pulls.list({ owner, repo, state: "open", head: `${owner}:${capsule.branch}` })
  ).data[0];
  let pr: { number: number; html_url: string };
  if (existing) {
    await octokit.pulls.update({ owner, repo, pull_number: existing.number, title, body: prBody });
    pr = existing;
  } else {
    const base = repoInfo.default_branch;
    try {
      pr = (
        await octokit.pulls.create({
          owner,
          repo,
          head: capsule.branch,
          base,
          title,
          body: prBody,
          draft: true,
        })
      ).data;
    } catch (err) {
      // Some plans do not support draft PRs; fall back to a normal PR that still says it must be reviewed.
      if (!/draft/i.test((err as Error).message)) throw err;
      pr = (await octokit.pulls.create({ owner, repo, head: capsule.branch, base, title, body: prBody }))
        .data;
    }
  }
  await octokit.issues.addLabels({ owner, repo, issue_number: pr.number, labels: Object.keys(LABELS) });

  if (checkRun) {
    await octokit.checks.create({
      owner,
      repo,
      name: "Themis",
      head_sha: headSha,
      status: "completed",
      conclusion: checkRun.conclusion,
      details_url: runUrl,
      output: {
        title: checkRun.title,
        summary: checkRun.summary,
        annotations: checkRun.annotations.slice(0, 50),
      },
    });
  }

  await comment(
    octokit,
    owner,
    repo,
    issueNumber,
    `Opened draft pull request #${pr.number} for \`${dep}\`: **${capsule.verdict}** (confidence: ${capsule.confidence}). Call sites covered: ${capsule.summary.callSitesCovered} of ${capsule.summary.callSites}.`,
  );
  if (findings) {
    const prs = await openThemisPrs(octokit, owner, repo);
    await tryDashboard(() =>
      upsertDashboard(octokit, owner, repo, findings, prs, runUrl, result.recommended),
    );
  }

  const alert = await sendAlert(
    {
      alertWebhookUrl: env("ALERT_WEBHOOK_URL", false) || undefined,
      alertWebhookSecret: env("ALERT_WEBHOOK_SECRET", false) || undefined,
    },
    {
      event: "pr_opened",
      repository: `${owner}/${repo}`,
      dependency: dep,
      verdict: capsule.verdict,
      pr_url: pr.html_url,
      capsule_url: `${repoInfo.html_url}/blob/${capsule.branch}/${capsulePath}`,
    },
  );
  console.log(`pull request: ${pr.html_url}; alert: ${alert.sent ? "sent" : alert.detail}`);
}

main().catch((err: unknown) => {
  console.error(`themis publish: ${(err as Error).message}`);
  process.exitCode = 1;
});
