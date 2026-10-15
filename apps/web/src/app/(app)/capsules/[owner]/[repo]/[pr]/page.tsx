import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CapsuleViewer } from "@/components/capsule/capsule-viewer";
import { TikoGuide } from "@/components/tiko-guide";
import { findRepo, getCapsuleForPr, listThemisPrs } from "@/lib/data";
import { userOctokit } from "@/lib/github";
import { requireUser } from "@/lib/session";

type Params = { params: Promise<{ owner: string; repo: string; pr: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner, repo, pr } = await params;
  return { title: `Capsule · ${owner}/${repo}#${pr}` };
}

export default async function CapsulePage({ params }: Params) {
  const { owner, repo: name, pr: prNumber } = await params;
  const { token } = await requireUser(`/capsules/${owner}/${name}/${prNumber}`);
  const repo = await findRepo(token, owner, name);
  if (!repo) notFound();
  const prs = await listThemisPrs(userOctokit(token), repo).catch(() => []);
  const pr = prs.find((p) => String(p.number) === prNumber);
  if (!pr) notFound();
  const record = await getCapsuleForPr(token, repo, pr);
  if (!record) notFound();

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/capsules" className="hover:text-ink">
          Capsules
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/repos/${repo.fullName}`} className="hover:text-ink">
          {repo.fullName}
        </Link>
      </nav>
      <CapsuleViewer
        capsule={record.capsule}
        repoUrl={repo.htmlUrl}
        prUrl={pr.url}
        capsuleUrl={record.capsuleUrl}
      />
      <TikoGuide
        id="capsule"
        message="Start with the verdict, then the gaps. Anything not proven by a test or a log is listed there."
      />
    </div>
  );
}
