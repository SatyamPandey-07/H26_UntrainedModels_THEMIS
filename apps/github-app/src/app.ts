import type { Context, Probot } from "probot";
import { DASHBOARD_TITLE, isDashboard, newlyTicked } from "./dashboard.js";

/** Runner repository that executes Themis jobs (`owner/name`); the App must be installed there too. */
const RUNNER_REPO = process.env.RUNNER_REPO ?? "SatyamPandey-07/H26_UntrainedModels_THEMIS";
const MAX_OPEN_PRS = Number(process.env.THEMIS_MAX_OPEN_PRS ?? 3);
const MAX_SCANS_PER_EVENT = 20;
const COMMAND_RE =
  /^\/themis(?:\s+(?:migrate\s+)?((?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*))?\s*$/im;
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export interface DispatchPayload {
  repository: string;
  mode: "run" | "scan";
  package?: string;
  issue_number?: string;
  trigger: string;
}

type AnyContext = Context<
  | "issue_comment.created"
  | "issues.edited"
  | "issues.labeled"
  | "installation.created"
  | "installation_repositories.added"
>;

/** Sends a repository_dispatch to the runner repo using the App's installation there. */
export async function dispatchRun(app: Probot, payload: DispatchPayload): Promise<void> {
  const [owner, repo] = RUNNER_REPO.split("/") as [string, string];
  const appOctokit = await app.auth();
  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });
  const octokit = await app.auth(installation.id);
  await octokit.rest.repos.createDispatchEvent({
    owner,
    repo,
    event_type: "themis-run",
    client_payload: { ...payload },
  });
  app.log.info({ payload }, "dispatched themis-run");
}

async function openThemisPrCount(context: AnyContext, owner: string, repo: string, pkg?: string) {
  const prs = await context.octokit.paginate(context.octokit.rest.pulls.list, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const themis = prs.filter(
    (p) => p.head.ref.startsWith("themis/") && p.labels.some((l) => l.name === "themis"),
  );
  const forPackage = pkg ? themis.find((p) => p.title.includes(`\`${pkg}\``)) : undefined;
  return { total: themis.length, forPackage };
}

async function senderCanWrite(
  context: AnyContext,
  owner: string,
  repo: string,
  username: string,
): Promise<boolean> {
  try {
    const { data } = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    return ["admin", "maintain", "write"].includes(data.permission);
  } catch {
    return false;
  }
}

export default (app: Probot): void => {
  app.on(["installation.created", "installation_repositories.added"], async (context) => {
    const repos =
      context.name === "installation"
        ? ((context.payload as { repositories?: Array<{ full_name: string }> }).repositories ?? [])
        : (context.payload as { repositories_added: Array<{ full_name: string }> }).repositories_added;
    for (const r of repos.slice(0, MAX_SCANS_PER_EVENT)) {
      if (r.full_name === RUNNER_REPO) continue;
      await dispatchRun(app, { repository: r.full_name, mode: "scan", trigger: "install" });
    }
  });

  app.on("issue_comment.created", async (context) => {
    const { comment, issue, repository } = context.payload;
    if (context.isBot || comment.user?.type === "Bot") return;
    const match = COMMAND_RE.exec(comment.body ?? "");
    if (!match) return;
    const owner = repository.owner.login;
    const repo = repository.name;
    if (!TRUSTED.has(comment.author_association)) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: "Themis only accepts `/themis` commands from people with write access to this repository.",
      });
      return;
    }
    const pkg = match[1];
    const limits = await openThemisPrCount(context, owner, repo, pkg);
    if (limits.forPackage) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `There is already an open Themis pull request for \`${pkg}\`: #${limits.forPackage.number}.`,
      });
      return;
    }
    if (limits.total >= MAX_OPEN_PRS) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `This repository already has ${limits.total} open Themis pull requests (limit ${MAX_OPEN_PRS}). Close or merge one first.`,
      });
      return;
    }
    await context.octokit.rest.reactions
      .createForIssueComment({ owner, repo, comment_id: comment.id, content: "rocket" })
      .catch(() => undefined);
    await context.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `Themis is starting a migration run for ${pkg ? `\`${pkg}\`` : "the recommended dependency"}. It will comment here with the result and a draft pull request.`,
    });
    await dispatchRun(app, {
      repository: repository.full_name,
      mode: "run",
      package: pkg,
      issue_number: String(issue.number),
      trigger: "comment",
    });
  });

  app.on("issues.edited", async (context) => {
    const { issue, repository, changes, sender } = context.payload;
    if (context.isBot || !isDashboard(issue.body) || issue.title !== DASHBOARD_TITLE) return;
    const before = changes.body?.from;
    if (before === undefined) return;
    const ticked = newlyTicked(before, issue.body ?? "");
    if (ticked.length === 0) return;
    const owner = repository.owner.login;
    const repo = repository.name;
    if (!(await senderCanWrite(context, owner, repo, sender.login))) return;
    const limits = await openThemisPrCount(context, owner, repo);
    const room = Math.max(0, MAX_OPEN_PRS - limits.total);
    for (const pkg of ticked.slice(0, room)) {
      await dispatchRun(app, {
        repository: repository.full_name,
        mode: "run",
        package: pkg,
        issue_number: String(issue.number),
        trigger: "dashboard",
      });
    }
    if (ticked.length > room) {
      await context.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `Started ${room} of ${ticked.length} requested migrations; the open pull request limit is ${MAX_OPEN_PRS}.`,
      });
    }
  });

  // Adding the `themis` label to an issue whose title names a package (`/themis <pkg>` or a backticked name).
  app.on("issues.labeled", async (context) => {
    const { issue, label, repository, sender } = context.payload;
    if (context.isBot || label?.name !== "themis" || isDashboard(issue.body)) return;
    const owner = repository.owner.login;
    const repo = repository.name;
    if (!(await senderCanWrite(context, owner, repo, sender.login))) return;
    const pkg = COMMAND_RE.exec(issue.title)?.[1] ?? /`([^`\s]+)`/.exec(issue.title)?.[1];
    const limits = await openThemisPrCount(context, owner, repo, pkg);
    if (limits.forPackage || limits.total >= MAX_OPEN_PRS) return;
    await context.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `Themis is starting a migration run for ${pkg ? `\`${pkg}\`` : "the recommended dependency"}.`,
    });
    await dispatchRun(app, {
      repository: repository.full_name,
      mode: "run",
      package: pkg,
      issue_number: String(issue.number),
      trigger: "label",
    });
  });

  // GitHub Marketplace plan events. Themis has a single free plan, so these are recorded, not billed.
  app.on("marketplace_purchase", async (context) => {
    const { action, marketplace_purchase: purchase } = context.payload;
    app.log.info(
      { action, account: purchase.account.login, plan: purchase.plan.name },
      "marketplace purchase event",
    );
  });
};
