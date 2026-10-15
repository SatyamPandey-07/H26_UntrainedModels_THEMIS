#!/usr/bin/env node
/**
 * Weekly rescan, run by the runner workflow's schedule. Lists every installation of the App, finds repositories
 * that have a Themis Dependency Dashboard, and queues a scan for each through repository_dispatch.
 *
 * Inputs (environment): THEMIS_APP_CLIENT_ID, THEMIS_APP_PRIVATE_KEY, GH_TOKEN (runner repo token),
 * RUNNER_REPO (owner/name).
 */
import { createSign } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { isDashboard } from "./dashboard.js";

const MAX_REPOS = 50;

function appJwt(clientId: string, privateKey: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: clientId })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main(): Promise<void> {
  const app = new Octokit({ auth: appJwt(need("THEMIS_APP_CLIENT_ID"), need("THEMIS_APP_PRIVATE_KEY")) });
  const runner = new Octokit({ auth: need("GH_TOKEN") });
  const [runnerOwner, runnerRepo] = need("RUNNER_REPO").split("/") as [string, string];
  const queued: string[] = [];

  const installations = await app.paginate(app.apps.listInstallations, { per_page: 100 });
  for (const inst of installations) {
    const { data: tok } = await app.apps.createInstallationAccessToken({ installation_id: inst.id });
    const octokit = new Octokit({ auth: tok.token });
    const repos = await octokit.paginate(octokit.apps.listReposAccessibleToInstallation, { per_page: 100 });
    for (const r of repos) {
      if (queued.length >= MAX_REPOS) break;
      if (r.full_name === `${runnerOwner}/${runnerRepo}` || r.archived || !r.has_issues) continue;
      const issues = await octokit.issues
        .listForRepo({ owner: r.owner.login, repo: r.name, state: "open", labels: "themis", per_page: 50 })
        .catch(() => ({ data: [] as Array<{ body?: string | null; pull_request?: unknown }> }));
      if (!issues.data.some((i) => !i.pull_request && isDashboard(i.body))) continue;
      await runner.repos.createDispatchEvent({
        owner: runnerOwner,
        repo: runnerRepo,
        event_type: "themis-run",
        client_payload: { repository: r.full_name, mode: "scan", trigger: "schedule" },
      });
      queued.push(r.full_name);
    }
  }
  console.log(`queued ${queued.length} scan(s): ${queued.join(", ") || "none"}`);
}

main().catch((err: unknown) => {
  console.error(`themis rescan: ${(err as Error).message}`);
  process.exitCode = 1;
});
