import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentTimeline } from "@/components/agent-timeline";
import { TikoGuide } from "@/components/tiko-guide";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chips";
import { getRun } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Run" };

const MODE: Record<string, string> = { scan: "Scan", plan: "Plan", run: "Migration" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { token } = await requireUser(`/runs/${id}`);
  if (!/^\d+$/.test(id)) notFound();
  const data = await getRun(token, Number(id)).catch(() => undefined);
  if (!data) notFound();
  const { run, jobs } = data;
  const failed = jobs.filter((j) => j.conclusion === "failure");

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/repos/${run.repository}`} className="text-sm text-ink-muted hover:text-ink">
            {run.repository}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {MODE[run.mode] ?? run.mode}
            {run.pkg !== "recommended" ? <span className="font-mono"> · {run.pkg}</span> : null}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            <StatusChip status={run.status} conclusion={run.conclusion} />
            started {timeAgo(run.createdAt)}
          </p>
        </div>
        <ButtonLink href={run.url} variant="secondary" size="sm" external>
          Open on GitHub Actions
          <ArrowSquareOut size={14} aria-hidden="true" />
        </ButtonLink>
      </header>

      <Card data-tour="timeline" className="p-6">
        <h2 className="text-lg font-bold">Agents</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Each box is a GitHub Actions job. The two Minos sandboxes run in parallel. This page refreshes while
          the run is going.
        </p>
        <div className="mt-6">
          <AgentTimeline jobs={jobs} runId={run.id} />
        </div>
      </Card>

      {failed.length ? (
        <Card className="border-danger/40 p-6">
          <h2 className="text-lg font-bold text-danger">Failed steps</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {failed.map((j) => (
              <li key={j.id}>
                <a href={j.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                  {j.name}
                </a>
                <span className="text-ink-muted">
                  {" "}
                  ·{" "}
                  {j.steps
                    .filter((s) => s.conclusion === "failure")
                    .map((s) => s.name)
                    .join(", ") || "see the job log"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TikoGuide
        id="run"
        mood="think"
        message="Each agent hands its state to the next. Click any box to read that job's log on GitHub."
      />
    </div>
  );
}
