import "server-only";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "./env";

/** Octokit acting as the signed-in user (only what they can see). */
export function userOctokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: "themis-web" });
}

/** Octokit acting as the Themis App's installation on a repository. */
export async function installationOctokit(owner: string, repo: string): Promise<Octokit> {
  const app = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: env.appId(), privateKey: env.privateKey() },
  });
  const { data } = await app.apps.getRepoInstallation({ owner, repo });
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: env.appId(), privateKey: env.privateKey(), installationId: data.id },
    userAgent: "themis-web",
  });
}

export function installUrl(returnTo?: string): string {
  const base = `https://github.com/apps/${env.appSlug()}/installations/new`;
  return returnTo ? `${base}?state=${encodeURIComponent(returnTo)}` : base;
}
