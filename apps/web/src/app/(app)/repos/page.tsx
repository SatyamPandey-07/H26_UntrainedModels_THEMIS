import { ArrowRight, Lock, Plus } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { getAllOverviews } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { installUrl } from "@/lib/github";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Repositories" };

export default async function Repos() {
  const { token } = await requireUser("/repos");
  const overviews = await getAllOverviews(token).catch(() => []);
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Repositories</h1>
          <p className="mt-1 text-sm text-ink-muted">Everything the Themis App is installed on.</p>
        </div>
        <ButtonLink href={installUrl("/repos")} variant="secondary" size="sm" external>
          <Plus size={15} weight="bold" aria-hidden="true" />
          Add repositories
        </ButtonLink>
      </header>
      {overviews.length === 0 ? (
        <EmptyState
          title="No repositories yet"
          body="Install the Themis App on GitHub and choose which repositories it may read."
          action={<ButtonLink href="/onboarding">Get started</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {overviews.map((o) => {
            const top = o.dashboard?.data?.dependencies[0];
            const open = o.prs.filter((p) => p.state === "open").length;
            return (
              <li key={o.repo.fullName}>
                <Link
                  href={`/repos/${o.repo.fullName}`}
                  className="group flex h-full flex-col gap-4 rounded-[20px] border border-border bg-surface p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono font-semibold">{o.repo.fullName}</span>
                    {o.repo.private ? (
                      <Lock size={14} className="text-ink-muted" aria-label="Private" />
                    ) : null}
                    <ArrowRight
                      size={16}
                      className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-ink-muted">Proposals</dt>
                      <dd className="font-mono font-semibold">{o.proposals.length}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">Open PRs</dt>
                      <dd className="font-mono font-semibold">{open}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">Last scan</dt>
                      <dd className="font-semibold">
                        {o.dashboard
                          ? timeAgo(o.dashboard.data?.scannedAt ?? o.dashboard.updatedAt)
                          : "never"}
                      </dd>
                    </div>
                  </dl>
                  {top ? (
                    <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs">
                      Riskiest: <span className="font-mono font-semibold">{top.name}</span> · score{" "}
                      {top.score}
                    </p>
                  ) : (
                    <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-muted">
                      Not scanned yet
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
