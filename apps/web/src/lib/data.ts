import "server-only";
import type { Octokit } from "@octokit/rest";
import type { Capsule } from "@themis/core";
import { isDashboard, proposalPackage, readDashboardData } from "@themis/github-app/dashboard";
import type { DashboardData } from "@themis/github-app/dashboard";
import { cache } from "react";
import { env } from "./env";
import { userOctokit } from "./github";

/**
 * Everything the web app shows comes from GitHub: Themis issues, draft PRs, check runs, the runner's workflow runs
 * and capsules committed on Themis branches. No separate database.
 */

export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  installationId: number;
}

export interface Installation {
  id: number;
  account: string;
  avatarUrl: string;
  repos: RepoRef[];
}

export interface Proposal {
  number: number;
  title: string;
  url: string;
  pkg: string;
  createdAt: string;
  comments: number;
}

export interface ThemisPr {
  number: number;
  title: string;
  url: string;
  branch: string;
  draft: boolean;
  state: "open" | "closed";
  merged: boolean;
  createdAt: string;
  repo: string;
}

export interface RepoOverview {
  repo: RepoRef;
  dashboard?: { number: number; url: string; data?: DashboardData; updatedAt: string };
  proposals: Proposal[];
  prs: ThemisPr[];
}

export interface RunSummary {
  id: number;
  title: string;
  mode: string;
  repository: string;
  pkg: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface RunJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: Array<{ name: string; status: string; conclusion: string | null }>;
}

export interface CapsuleRecord {
  capsule: Capsule;
  pr: ThemisPr;
  path: string;
  capsuleUrl: string;
}

const octo = cache((token: string) => userOctokit(token));

export const getInstallations = cache(async (token: string): Promise<Installation[]> => {
  const gh = octo(token);
  const installs = await gh.paginate(gh.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
  return Promise.all(
    installs.map(async (i) => {
      const repos = await gh.paginate(gh.apps.listInstallationReposForAuthenticatedUser, {
        installation_id: i.id,
        per_page: 100,
      });
      const account = i.account && "login" in i.account ? i.account.login : (i.account?.name ?? "unknown");
      return {
        id: i.id,
        account,
        avatarUrl: i.account?.avatar_url ?? "",
        repos: repos
          .filter((r) => !r.archived)
          .map((r) => ({
            owner: r.owner.login,
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            defaultBranch: r.default_branch,
            htmlUrl: r.html_url,
            installationId: i.id,
          })),
      };
    }),
  );
});

export async function getRepos(token: string): Promise<RepoRef[]> {
  const runner = env.runnerRepo();
  return (await getInstallations(token)).flatMap((i) => i.repos).filter((r) => r.fullName !== runner);
}

export async function findRepo(token: string, owner: string, name: string): Promise<RepoRef | undefined> {
  return (await getRepos(token)).find((r) => r.owner === owner && r.name === name);
}

function toPr(
  p: {
    number: number;
    title: string;
    html_url: string;
    head: { ref: string };
    draft?: boolean;
    state: string;
    merged_at?: string | null;
    created_at: string;
  },
  repo: string,
): ThemisPr {
  return {
    number: p.number,
    title: p.title,
    url: p.html_url,
    branch: p.head.ref,
    draft: Boolean(p.draft),
    state: p.state === "open" ? "open" : "closed",
    merged: Boolean(p.merged_at),
    createdAt: p.created_at,
    repo,
  };
}

export async function listThemisPrs(gh: Octokit, repo: RepoRef): Promise<ThemisPr[]> {
  const prs = await gh.paginate(gh.pulls.list, {
    owner: repo.owner,
    repo: repo.name,
    state: "all",
    per_page: 100,
  });
  return prs.filter((p) => p.head.ref.startsWith("themis/")).map((p) => toPr(p, repo.fullName));
}

export const getRepoOverview = cache(async (token: string, repo: RepoRef): Promise<RepoOverview> => {
  const gh = octo(token);
  const [issues, prs] = await Promise.all([
    gh
      .paginate(gh.issues.listForRepo, {
        owner: repo.owner,
        repo: repo.name,
        state: "open",
        labels: "themis",
        per_page: 100,
      })
      .catch(() => []),
    listThemisPrs(gh, repo).catch(() => []),
  ]);
  const plain = issues.filter((i) => !i.pull_request);
  const dash = plain.find((i) => isDashboard(i.body));
  const proposals: Proposal[] = plain.flatMap((i) => {
    const pkg = proposalPackage(i.body);
    return pkg
      ? [
          {
            number: i.number,
            title: i.title,
            url: i.html_url,
            pkg,
            createdAt: i.created_at,
            comments: i.comments,
          },
        ]
      : [];
  });
  return {
    repo,
    dashboard: dash
      ? {
          number: dash.number,
          url: dash.html_url,
          data: readDashboardData(dash.body),
          updatedAt: dash.updated_at,
        }
      : undefined,
    proposals,
    prs,
  };
});

export async function getAllOverviews(token: string): Promise<RepoOverview[]> {
  const repos = await getRepos(token);
  return Promise.all(repos.map((r) => getRepoOverview(token, r)));
}

/** "Themis · run · owner/repo · package" → parts. */
export function parseRunTitle(title: string): { mode: string; repository: string; pkg: string } | undefined {
  const m = /^Themis · (\w+) · (\S+) · (.+)$/.exec(title);
  return m ? { mode: m[1] as string, repository: m[2] as string, pkg: m[3] as string } : undefined;
}

export async function listRuns(token: string, repos: string[], limit = 50): Promise<RunSummary[]> {
  const gh = octo(token);
  const [owner, repo] = env.runnerRepo().split("/") as [string, string];
  const { data } = await gh.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: "themis-runner.yml",
    per_page: 100,
  });
  const allowed = new Set(repos);
  return data.workflow_runs
    .flatMap((r) => {
      const parts = parseRunTitle(r.display_title);
      if (!parts || !allowed.has(parts.repository)) return [];
      return [
        {
          id: r.id,
          title: r.display_title,
          ...parts,
          status: r.status ?? "unknown",
          conclusion: r.conclusion,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          url: r.html_url,
        },
      ];
    })
    .slice(0, limit);
}

export async function getRun(
  token: string,
  id: number,
): Promise<{ run: RunSummary; jobs: RunJob[] } | undefined> {
  const gh = octo(token);
  const [owner, repo] = env.runnerRepo().split("/") as [string, string];
  const { data: r } = await gh.actions.getWorkflowRun({ owner, repo, run_id: id });
  const parts = parseRunTitle(r.display_title);
  if (!parts) return undefined;
  const allowed = new Set((await getRepos(token)).map((x) => x.fullName));
  if (!allowed.has(parts.repository)) return undefined;
  const jobs = await gh.paginate(gh.actions.listJobsForWorkflowRun, {
    owner,
    repo,
    run_id: id,
    per_page: 100,
  });
  return {
    run: {
      id: r.id,
      title: r.display_title,
      ...parts,
      status: r.status ?? "unknown",
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      url: r.html_url,
    },
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      startedAt: j.started_at,
      completedAt: j.completed_at ?? null,
      url: j.html_url ?? r.html_url,
      steps: (j.steps ?? []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
    })),
  };
}

function dependencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Reads `.themis/<slug>/capsule.json` from a Themis PR's branch. */
export async function getCapsuleForPr(
  token: string,
  repo: RepoRef,
  pr: ThemisPr,
): Promise<CapsuleRecord | undefined> {
  const gh = octo(token);
  const slug = /^themis\/(.+)-\d{8}$/.exec(pr.branch)?.[1];
  if (!slug) return undefined;
  const path = `.themis/${slug}/capsule.json`;
  try {
    const { data } = await gh.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref: pr.branch });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return undefined;
    const capsule = JSON.parse(Buffer.from(data.content, "base64").toString("utf8")) as Capsule;
    return {
      capsule,
      pr,
      path,
      capsuleUrl: `${repo.htmlUrl}/blob/${encodeURIComponent(pr.branch).replace(/%2F/g, "/")}/${path.replace(/\.json$/, ".md")}`,
    };
  } catch {
    return undefined;
  }
}

export async function listCapsules(token: string): Promise<Array<CapsuleRecord & { repo: RepoRef }>> {
  const overviews = await getAllOverviews(token);
  const records = await Promise.all(
    overviews.flatMap((o) =>
      o.prs.map(async (pr) => {
        const rec = await getCapsuleForPr(token, o.repo, pr);
        return rec ? { ...rec, repo: o.repo } : undefined;
      }),
    ),
  );
  return records
    .filter((r): r is CapsuleRecord & { repo: RepoRef } => Boolean(r))
    .sort((a, b) => b.pr.createdAt.localeCompare(a.pr.createdAt));
}

export async function getThemisConfigText(token: string, repo: RepoRef): Promise<string | undefined> {
  try {
    const { data } = await octo(token).repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path: ".github/themis.yml",
    });
    if (Array.isArray(data) || !("content" in data)) return undefined;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

export { dependencySlug };

export interface ActivityItem {
  key: string;
  kind: "pr" | "proposal" | "dashboard";
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Page inside the web app, when there is one (capsule for PRs, repository for issues). */
  href: string;
  at: string;
  status: "draft" | "open" | "merged" | "closed";
  comments?: number;
}

/** Issues and pull requests Themis raised, newest first, across the given repositories. */
export function activityFor(overviews: RepoOverview[], limit = 12): ActivityItem[] {
  return overviews
    .flatMap((o) => {
      const repo = o.repo.fullName;
      const items: ActivityItem[] = [
        ...o.prs.map((p) => ({
          key: `${repo}#pr${p.number}`,
          kind: "pr" as const,
          repo,
          number: p.number,
          title: p.title,
          url: p.url,
          href: `/capsules/${repo}/${p.number}`,
          at: p.createdAt,
          status: p.merged
            ? ("merged" as const)
            : p.state === "closed"
              ? ("closed" as const)
              : p.draft
                ? ("draft" as const)
                : ("open" as const),
        })),
        ...o.proposals.map((p) => ({
          key: `${repo}#${p.number}`,
          kind: "proposal" as const,
          repo,
          number: p.number,
          title: p.title,
          url: p.url,
          href: `/repos/${repo}`,
          at: p.createdAt,
          status: "open" as const,
          comments: p.comments,
        })),
      ];
      if (o.dashboard)
        items.push({
          key: `${repo}#${o.dashboard.number}`,
          kind: "dashboard",
          repo,
          number: o.dashboard.number,
          title: "Dependency Dashboard updated",
          url: o.dashboard.url,
          href: `/repos/${repo}`,
          at: o.dashboard.updatedAt,
          status: "open",
        });
      return items;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
