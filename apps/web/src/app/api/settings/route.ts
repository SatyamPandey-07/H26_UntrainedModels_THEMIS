import { NextResponse, type NextRequest } from "next/server";
import { stringify } from "yaml";
import { z } from "zod";
import { userOctokit } from "@/lib/github";
import { getSession } from "@/lib/session";

const Body = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  config: z.object({
    autoMigrate: z.boolean(),
    autoMigrateIntervalDays: z.number().int().min(1).max(365),
    ignore: z.array(z.string().min(1)).max(100),
    maxOpenPrs: z.number().int().min(1).max(10),
    proposals: z.number().int().min(0).max(10),
  }),
});

// Saves `.github/themis.yml` as a pull request, never a direct write to the default branch.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings." }, { status: 400 });
  const [owner, repo] = parsed.data.repository.split("/") as [string, string];
  const gh = userOctokit(session.token);
  const { data: info } = await gh.repos.get({ owner, repo });
  if (!info.permissions?.push) return NextResponse.json({ error: "You need write access." }, { status: 403 });

  const base = info.default_branch;
  const { data: ref } = await gh.git.getRef({ owner, repo, ref: `heads/${base}` });
  // Outside the themis/ namespace so it is never counted as a migration PR.
  const branch = `themis-settings/${Date.now()}`;
  await gh.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: ref.object.sha });
  const path = ".github/themis.yml";
  let sha: string | undefined;
  try {
    const { data } = await gh.repos.getContent({ owner, repo, path, ref: base });
    if (!Array.isArray(data)) sha = data.sha;
  } catch {
    sha = undefined;
  }
  const content = `# Themis settings. See https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS/blob/main/apps/github-app/README.md\n${stringify(parsed.data.config)}`;
  await gh.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    sha,
    message: "chore(themis): update Themis settings",
    content: Buffer.from(content).toString("base64"),
  });
  const { data: pr } = await gh.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: "chore(themis): update Themis settings",
    body: "Updates `.github/themis.yml` from the Themis web app. Merge to apply.",
  });
  return NextResponse.json({ ok: true, url: pr.html_url });
}
