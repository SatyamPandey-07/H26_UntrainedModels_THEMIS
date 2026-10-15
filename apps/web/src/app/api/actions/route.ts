import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { installationOctokit, userOctokit } from "@/lib/github";
import { getSession } from "@/lib/session";

const Body = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  mode: z.enum(["scan", "plan", "run"]),
  package: z
    .string()
    .regex(/^(@[A-Za-z0-9~][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~][A-Za-z0-9._~-]*$/)
    .optional(),
  issue: z.number().int().positive().optional(),
});

// Plan, Migrate and Scan buttons: the same dispatch a `/themis` comment makes, after the same write-access check.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { repository, mode, package: pkg, issue } = parsed.data;
  const [owner, repo] = repository.split("/") as [string, string];

  const { data: repoInfo } = await userOctokit(session.token).repos.get({ owner, repo });
  if (!repoInfo.permissions?.push)
    return NextResponse.json(
      { error: "Only people with write access can start Themis runs." },
      { status: 403 },
    );

  const [runnerOwner, runnerRepo] = env.runnerRepo().split("/") as [string, string];
  const runner = await installationOctokit(runnerOwner, runnerRepo);
  await runner.repos.createDispatchEvent({
    owner: runnerOwner,
    repo: runnerRepo,
    event_type: "themis-run",
    client_payload: {
      repository,
      mode,
      package: pkg ?? "",
      issue_number: issue ? String(issue) : "",
      trigger: `web:${session.user?.login ?? "unknown"}`,
    },
  });
  return NextResponse.json({ ok: true, runsUrl: `/runs?repo=${encodeURIComponent(repository)}` });
}
