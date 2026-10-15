import { ArrowSquareOut, GearSix, GitPullRequest, Warning } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { ActivityFeed } from "@/components/app/activity-feed";
import { EmptyState } from "@/components/app/empty-state";
import { RunList } from "@/components/app/run-list";
import { TikoGuide } from "@/components/tiko-guide";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { activityFor, findRepo, getRepoOverview, listRuns } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/lib/session";

type Params = { params: Promise<{ owner: string; repo: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `${owner}/${repo}` };
}

export default async function RepoPage({ params }: Params) {
  const { owner, repo: name } = await params;
  const { token } = await requireUser(`/repos/${owner}/${name}`);
  const repo = await findRepo(token, owner, name);
  if (!repo) notFound();
  const [overview, runs] = await Promise.all([
    getRepoOverview(token, repo),
    listRuns(token, [repo.fullName], 6).catch(() => []),
  ]);
  const deps = overview.dashboard?.data?.dependencies ?? [];
  const proposalFor = new Map(overview.proposals.map((p) => [p.pkg, p]));
  const prFor = new Map(
    overview.prs
      .filter((p) => p.state === "open")
      .map((p) => [p.branch.replace(/^themis\//, "").replace(/-\d{8}$/, ""), p]),
  );
  const slug = (n: string) =>
    n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const max = Math.max(1, ...deps.map((d) => d.score));

  return (
    <div className="mx-auto grid max-w-6xl gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/repos" className="text-sm text-ink-muted hover:text-ink">
            Repositories
          </Link>
          <h1 className="mt-1 truncate font-mono text-2xl font-bold md:text-3xl">{repo.fullName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {overview.dashboard
              ? `Last scan ${timeAgo(overview.dashboard.data?.scannedAt ?? overview.dashboard.updatedAt)} on ${overview.dashboard.data?.baseRef ?? repo.defaultBranch}`
              : "Not scanned yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-tour="repo-actions">
          <ActionButton repository={repo.fullName} mode="scan" label="Scan now" variant="primary" />
          <ButtonLink href={`/settings/${repo.fullName}`} variant="secondary" size="sm">
            <GearSix size={15} aria-hidden="true" />
            Settings
          </ButtonLink>
          {overview.dashboard ? (
            <ButtonLink href={overview.dashboard.url} variant="ghost" size="sm" external>
              Dashboard issue
              <ArrowSquareOut size={14} aria-hidden="true" />
            </ButtonLink>
          ) : null}
        </div>
      </header>

      <Card data-tour="deps" className="p-6">
        <SectionTitle
          title="Dependencies by risk"
          description="Plan first to see what would change, or migrate straight away. Both open a run you can watch."
        />
        {deps.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th scope="col" className="pb-3 font-medium">
                    Package
                  </th>
                  <th scope="col" className="pb-3 font-medium">
                    Version
                  </th>
                  <th scope="col" className="w-48 pb-3 font-medium">
                    Risk
                  </th>
                  <th scope="col" className="pb-3 font-medium">
                    Signals
                  </th>
                  <th scope="col" className="pb-3 text-right font-medium">
                    Next step
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deps.map((d) => {
                  const proposal = proposalFor.get(d.name);
                  const pr = prFor.get(slug(d.name));
                  return (
                    <tr key={d.name} className="align-middle">
                      <td className="py-3 pr-3">
                        <span className="font-mono font-semibold">{d.name}</span>
                        {d.dev ? (
                          <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
                            dev
                          </span>
                        ) : null}
                        {d.importingFiles !== undefined ? (
                          <span className="block text-xs text-ink-muted">
                            imported by {d.importingFiles} file{d.importingFiles === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs">
                        {d.currentVersion}
                        {d.latestVersion && d.latestVersion !== d.currentVersion ? (
                          <span className="text-ink-muted"> to {d.latestVersion}</span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${(d.score / max) * 100}%` }}
                            />
                          </div>
                          <span className="w-8 text-right font-mono text-xs">{d.score}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        <span className="flex flex-wrap gap-1">
                          {d.vulnerabilities ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-danger">
                              <Warning size={11} weight="bold" aria-hidden="true" />
                              {d.vulnerabilities} vuln{d.vulnerabilities === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {d.deprecated ? (
                            <span className="rounded-full bg-[var(--tag-unverified-bg)] px-2 py-0.5 text-[color:var(--tag-unverified)]">
                              deprecated
                            </span>
                          ) : null}
                          {d.ageDays ? (
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">
                              {Math.round(d.ageDays / 30)} mo old
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {pr ? (
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                          >
                            <GitPullRequest size={15} aria-hidden="true" />
                            PR #{pr.number}
                          </a>
                        ) : (
                          <span className="inline-flex justify-end gap-2">
                            <ActionButton
                              repository={repo.fullName}
                              mode="plan"
                              pkg={d.name}
                              issue={proposal?.number}
                              label="Plan"
                              variant="secondary"
                            />
                            <ActionButton
                              repository={repo.fullName}
                              mode="run"
                              pkg={d.name}
                              issue={proposal?.number}
                              label="Migrate"
                              variant="accent"
                            />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5">
            <EmptyState
              title="No scan results yet"
              body="Start a scan. Argus reads the manifests and registries and ranks every direct dependency."
              action={<ActionButton repository={repo.fullName} mode="scan" label="Scan now" />}
            />
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionTitle
            title="Issues and pull requests"
            description="Proposals, the dashboard and draft PRs Themis opened here."
          />
          <div className="mt-2">
            <ActivityFeed items={activityFor([overview], 20)} showRepo={false} />
          </div>
        </Card>
        <Card className="p-6">
          <SectionTitle
            title="Runs"
            action={
              <ButtonLink
                href={`/runs?repo=${encodeURIComponent(repo.fullName)}`}
                variant="secondary"
                size="sm"
              >
                All
              </ButtonLink>
            }
          />
          {runs.length ? (
            <RunList runs={runs} />
          ) : (
            <p className="mt-4 text-sm text-ink-muted">No runs for this repository yet.</p>
          )}
        </Card>
      </div>

      <TikoGuide
        id="repo"
        mood="point"
        message="Pick a dependency. Plan shows what would change without touching anything; Migrate does the work on its own branch."
        tour={[
          {
            element: "[data-tour=deps]",
            title: "Ranked by risk",
            body: "The bar shows how risky each package is compared with the others here.",
          },
          {
            element: "[data-tour=repo-actions]",
            title: "Scan and settings",
            body: "Rescan any time. Settings saves your choices as a pull request.",
          },
        ]}
      />
    </div>
  );
}
