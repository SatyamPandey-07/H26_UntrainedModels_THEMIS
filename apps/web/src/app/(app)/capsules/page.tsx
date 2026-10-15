import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { TagChip, VerdictChip } from "@/components/ui/chips";
import { listCapsules } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { tagCounts } from "@/lib/sample";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Capsules" };

export default async function Capsules() {
  const { token } = await requireUser("/capsules");
  const capsules = await listCapsules(token).catch(() => []);
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Capsules</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every migration report, with the evidence behind each claim.
        </p>
      </header>
      {capsules.length === 0 ? (
        <EmptyState
          title="No capsules yet"
          body="A capsule is written when a migration finishes. Start one from a repository page, or read the sample first."
          action={
            <ButtonLink href="/capsule/sample" variant="secondary">
              Read the sample capsule
            </ButtonLink>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {capsules.map(({ capsule, pr, repo }) => {
            const counts = tagCounts(capsule);
            return (
              <li key={`${repo.fullName}#${pr.number}`}>
                <Link
                  href={`/capsules/${repo.fullName}/${pr.number}`}
                  className="group grid gap-3 rounded-[20px] border border-border bg-surface p-5 transition-colors hover:border-primary/40 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-ink-muted">
                      {repo.fullName} · PR #{pr.number} · {timeAgo(pr.createdAt)}
                    </p>
                    <p className="mt-1 truncate font-mono text-lg font-bold">
                      {capsule.dependency.name}{" "}
                      <span className="font-normal text-ink-muted">
                        {capsule.dependency.from} to{" "}
                        {capsule.dependency.to?.replace(`${capsule.dependency.name}@`, "") ?? "n/a"}
                      </span>
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <TagChip tag="EXECUTED" count={counts.EXECUTED} />
                      <TagChip tag="UNVERIFIED" count={counts.UNVERIFIED} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <VerdictChip verdict={capsule.verdict} />
                    <ArrowRight
                      size={18}
                      className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
