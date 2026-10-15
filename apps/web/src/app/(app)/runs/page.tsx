import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { RunList } from "@/components/app/run-list";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getRepos, listRuns } from "@/lib/data";
import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Runs" };

export default async function Runs({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  const { token } = await requireUser("/runs");
  const repos = (await getRepos(token).catch(() => [])).map((r) => r.fullName);
  const scope = repo && repos.includes(repo) ? [repo] : repos;
  const runs = await listRuns(token, scope).catch(() => []);
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Runs</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Each run is a GitHub Actions workflow with one job per agent. Open one to watch it live.
        </p>
      </header>
      {repos.length > 1 ? (
        <nav aria-label="Filter by repository" className="flex flex-wrap gap-2">
          {[undefined, ...repos].map((r) => (
            <Link
              key={r ?? "all"}
              href={r ? `/runs?repo=${encodeURIComponent(r)}` : "/runs"}
              aria-current={(repo ?? undefined) === r ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold",
                (repo ?? undefined) === r
                  ? "border-primary bg-primary text-white dark:text-[#120c2b]"
                  : "border-border text-ink-muted hover:text-ink",
              )}
            >
              {r ?? "All repositories"}
            </Link>
          ))}
        </nav>
      ) : null}
      <Card className="px-6 py-3">
        {runs.length ? (
          <RunList runs={runs} />
        ) : (
          <div className="py-6">
            <EmptyState
              title="No runs yet"
              body="Scan a repository to start the first one."
              action={<ButtonLink href="/repos">Pick a repository</ButtonLink>}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
