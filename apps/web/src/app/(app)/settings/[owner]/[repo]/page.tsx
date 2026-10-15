import { RepoConfig } from "@themis/github-app/config";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parse } from "yaml";
import { SettingsForm } from "@/components/app/settings-form";
import { Card } from "@/components/ui/card";
import { findRepo, getThemisConfigText } from "@/lib/data";
import { userOctokit } from "@/lib/github";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo: name } = await params;
  const { token } = await requireUser(`/settings/${owner}/${name}`);
  const repo = await findRepo(token, owner, name);
  if (!repo) notFound();
  const [text, info] = await Promise.all([
    getThemisConfigText(token, repo),
    userOctokit(token)
      .repos.get({ owner, repo: name })
      .then((r) => r.data)
      .catch(() => undefined),
  ]);
  let raw: unknown;
  try {
    raw = text ? (parse(text) ?? {}) : {};
  } catch {
    raw = {};
  }
  const parsed = RepoConfig.safeParse(raw);
  const config = parsed.success ? parsed.data : RepoConfig.parse({});

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <Link href={`/repos/${repo.fullName}`} className="text-sm text-ink-muted hover:text-ink">
          {repo.fullName}
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Stored in <code className="font-mono">.github/themis.yml</code>. Every field is optional; Themis
          works without the file.
          {text && !parsed.success ? " The current file has invalid values, so defaults are shown." : ""}
        </p>
      </header>
      <Card className="p-6 md:p-8">
        <SettingsForm
          repository={repo.fullName}
          initial={config}
          canWrite={Boolean(info?.permissions?.push)}
        />
      </Card>
    </div>
  );
}
