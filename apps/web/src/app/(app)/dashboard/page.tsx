import {
  ArrowRight,
  FolderSimple,
  GitPullRequest,
  Lightbulb,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/app/empty-state";
import { RiskChart } from "@/components/app/risk-chart";
import { RunList } from "@/components/app/run-list";
import { TikoGuide } from "@/components/tiko-guide";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { getAllOverviews, listRuns } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const { user, token } = await requireUser("/dashboard");
  const overviews = await getAllOverviews(token).catch(() => []);
  if (overviews.length === 0) redirect("/onboarding");
  const runs = await listRuns(
    token,
    overviews.map((o) => o.repo.fullName),
    8,
  ).catch(() => []);

  const proposals = overviews.flatMap((o) => o.proposals.map((p) => ({ ...p, repo: o.repo.fullName })));
  const prs = overviews.flatMap((o) => o.prs);
  const openPrs = prs.filter((p) => p.state === "open");
  const risks = overviews
    .flatMap((o) =>
      (o.dashboard?.data?.dependencies ?? []).map((d) => ({
        name: d.name,
        repo: o.repo.fullName,
        score: d.score,
      })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const stats = [
    { label: "Repositories", value: overviews.length, Icon: FolderSimple, href: "/repos" },
    { label: "Open proposals", value: proposals.length, Icon: Lightbulb, href: "/repos" },
    { label: "Draft PRs open", value: openPrs.length, Icon: GitPullRequest, href: "/capsules" },
    { label: "Capsules written", value: prs.length, Icon: ShieldCheck, href: "/capsules" },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-8">
      <header>
        <p className="text-sm text-ink-muted">Hello, {user.name?.split(" ")[0] ?? user.login}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Your dependency health</h1>
      </header>

      <div data-tour="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Link
            key={s.label}
            href={s.href}
            className={`rounded-[20px] p-5 transition-transform hover:-translate-y-0.5 ${
              i === 0
                ? "bg-primary-strong text-white dark:bg-[#2a1f63]"
                : i === 1
                  ? "bg-accent text-accent-ink"
                  : "border border-border bg-surface"
            }`}
          >
            <s.Icon size={22} weight="duotone" aria-hidden="true" />
            <p className="mt-4 font-mono text-3xl font-bold">{s.value}</p>
            <p className={`text-sm ${i < 2 ? "opacity-80" : "text-ink-muted"}`}>{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card data-tour="risk" className="p-6">
          <SectionTitle
            title="Riskiest dependencies"
            description="Risk weighed by how much of the code imports each package."
          />
          <div className="mt-4">
            <RiskChart data={risks} />
          </div>
        </Card>
        <Card data-tour="proposals" className="p-6">
          <SectionTitle
            title="Waiting on you"
            description="Proposals Themis opened. Plan or migrate from the repository page."
          />
          {proposals.length ? (
            <ul className="mt-4 divide-y divide-border">
              {proposals.slice(0, 6).map((p) => (
                <li key={`${p.repo}#${p.number}`}>
                  <Link href={`/repos/${p.repo}`} className="flex items-center gap-3 py-3 hover:underline">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm font-semibold">{p.pkg}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {p.repo} · #{p.number} · {timeAgo(p.createdAt)}
                      </span>
                    </span>
                    <ArrowRight size={16} className="text-ink-muted" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-sm text-ink-muted">
              Nothing waiting. Run a scan to look for new candidates.
            </p>
          )}
        </Card>
      </div>

      <Card data-tour="runs" className="p-6">
        <SectionTitle
          title="Recent runs"
          description="Every agent job on GitHub Actions, newest first."
          action={
            <ButtonLink href="/runs" variant="secondary" size="sm">
              All runs
            </ButtonLink>
          }
        />
        <div className="mt-3">
          {runs.length ? (
            <RunList runs={runs} />
          ) : (
            <EmptyState
              title="No runs yet"
              body="Start a scan from a repository page and the agents will show up here as they work."
            />
          )}
        </div>
      </Card>

      <TikoGuide
        id="dashboard"
        message="This is your home base. Want a quick tour of what each card means?"
        tour={[
          {
            element: "[data-tour=stats]",
            title: "At a glance",
            body: "Repositories Themis watches, proposals waiting for you, open draft PRs and capsules written.",
          },
          {
            element: "[data-tour=risk]",
            title: "Riskiest dependencies",
            body: "Scores combine vulnerabilities, deprecation and age, weighted by how many files import the package.",
          },
          {
            element: "[data-tour=proposals]",
            title: "Waiting on you",
            body: "Themis never jumps in. Each proposal waits for you to plan or migrate.",
          },
          {
            element: "[data-tour=runs]",
            title: "Recent runs",
            body: "Open a run to watch each agent hand off to the next, live.",
          },
          {
            element: "[data-tour=nav-capsules]",
            title: "Capsules",
            body: "Every finished migration has a capsule with evidence for each claim.",
          },
        ]}
      />
    </div>
  );
}
