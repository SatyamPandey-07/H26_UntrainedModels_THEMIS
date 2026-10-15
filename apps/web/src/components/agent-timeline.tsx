"use client";

import {
  CheckCircle,
  CircleDashed,
  CircleNotch,
  Eye,
  FileMagnifyingGlass,
  GitPullRequest,
  Hammer,
  MinusCircle,
  Scales,
  ShieldCheck,
  Sparkle,
  XCircle,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export interface TimelineJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: Array<{ name: string; status: string; conclusion: string | null }>;
}

const AGENTS = [
  { key: "Prepare", label: "Prepare", role: "Read-only clone", Icon: ShieldCheck },
  { key: "Argus", label: "Argus", role: "Scout", Icon: Eye },
  { key: "Athena", label: "Athena", role: "Planner", Icon: FileMagnifyingGlass },
  { key: "Hephaestus", label: "Hephaestus", role: "Migrator", Icon: Hammer },
  { key: "Minos-sides", label: "Minos", role: "Sandboxes", Icon: Scales },
  { key: "Minos · Verdict", label: "Minos", role: "Verdict", Icon: Scales },
  { key: "Clio", label: "Clio", role: "Capsule writer", Icon: Sparkle },
  { key: "Publish", label: "Publish", role: "PR, issues, check run", Icon: GitPullRequest },
] as const;

function state(job?: TimelineJob): "pending" | "running" | "success" | "failure" | "skipped" {
  if (!job) return "pending";
  if (job.status !== "completed")
    return job.status === "queued" || job.status === "waiting" ? "pending" : "running";
  if (job.conclusion === "success") return "success";
  if (job.conclusion === "skipped" || job.conclusion === "cancelled" || job.conclusion === "neutral")
    return "skipped";
  return "failure";
}

function duration(job?: TimelineJob): string {
  if (!job?.startedAt) return "";
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function StateIcon({ s }: { s: ReturnType<typeof state> }) {
  const reduce = useReducedMotion();
  if (s === "success")
    return (
      <CheckCircle
        size={18}
        weight="fill"
        className="text-[color:var(--tag-executed)]"
        aria-label="Succeeded"
      />
    );
  if (s === "failure") return <XCircle size={18} weight="fill" className="text-danger" aria-label="Failed" />;
  if (s === "skipped")
    return <MinusCircle size={18} weight="fill" className="text-ink-muted" aria-label="Skipped" />;
  if (s === "running")
    return (
      <motion.span
        animate={reduce ? {} : { rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
        className="grid"
      >
        <CircleNotch
          size={18}
          weight="bold"
          className="text-[color:var(--tag-observed)]"
          aria-label="Running"
        />
      </motion.span>
    );
  return <CircleDashed size={18} className="text-ink-muted" aria-label="Waiting" />;
}

function Box({
  label,
  role,
  Icon,
  job,
  retry,
}: {
  label: string;
  role: string;
  Icon: typeof Eye;
  job?: TimelineJob;
  retry?: boolean;
}) {
  const s = state(job);
  const reduce = useReducedMotion();
  const body = (
    <motion.div
      layout={!reduce}
      className={cn(
        "relative flex min-w-0 items-center gap-3 rounded-2xl border bg-surface px-4 py-3 shadow-[var(--shadow)] transition-colors lg:w-56",
        s === "running"
          ? "border-[color:var(--tag-observed)]"
          : s === "failure"
            ? "border-danger"
            : "border-border",
        s === "skipped" && "opacity-55 shadow-none",
      )}
    >
      {s === "running" && !reduce ? (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-2xl ring-2 ring-[color:var(--tag-observed)]"
          animate={{ opacity: [0.2, 0.7, 0.2] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      ) : null}
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon size={18} weight="duotone" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">
          {label}
          {retry ? <span className="ml-1 font-medium text-ink-muted">(retry)</span> : null}
        </span>
        <span className="block truncate text-xs text-ink-muted">{role}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-xs text-ink-muted">{duration(job)}</span>
        <StateIcon s={s} />
      </span>
    </motion.div>
  );
  return job && job.url !== "#" ? (
    <a
      href={job.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-2xl"
      aria-label={`${label} ${role} job on GitHub`}
    >
      {body}
    </a>
  ) : (
    body
  );
}

function Connector() {
  return <span aria-hidden="true" className="mx-auto h-5 w-px bg-border lg:mx-0 lg:my-auto lg:h-px lg:w-5" />;
}

/** The six agents as connected boxes; the Minos sandboxes sit side by side because they run in parallel. */
export function AgentTimeline({ jobs: initial, runId }: { jobs: TimelineJob[]; runId?: number }) {
  const [jobs, setJobs] = useState(initial);

  useEffect(() => {
    if (!runId) return;
    const done = () => jobs.length > 0 && jobs.every((j) => j.status === "completed");
    if (done()) return;
    const t = window.setInterval(async () => {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { jobs: TimelineJob[] };
        setJobs(data.jobs);
      }
    }, 8000);
    return () => window.clearInterval(t);
  }, [runId, jobs]);

  const find = (prefix: string, retry = false) =>
    jobs.find((j) => j.name.startsWith(prefix) && j.name.includes("(retry)") === retry);
  const sides = (retry: boolean) =>
    ["baseline", "candidate"].map((side) =>
      jobs.find((j) => j.name.startsWith(`Minos · ${side}`) && j.name.includes("(retry)") === retry),
    );
  const hasRetry = jobs.some((j) => j.name.includes("(retry)") && j.conclusion !== "skipped");

  const lane = (retry: boolean) =>
    AGENTS.flatMap((a, i) => {
      if (retry && ["Prepare", "Argus", "Athena", "Clio", "Publish"].includes(a.key)) return [];
      const node =
        a.key === "Minos-sides" ? (
          <div key={a.key + retry} className="grid gap-2">
            {sides(retry).map((j, idx) => (
              <Box
                key={idx}
                label="Minos"
                role={idx === 0 ? "Baseline sandbox" : "Candidate sandbox"}
                Icon={Scales}
                job={j}
                retry={retry}
              />
            ))}
          </div>
        ) : (
          <Box
            key={a.key + retry}
            label={a.label}
            role={a.role}
            Icon={a.Icon}
            job={find(a.key === "Minos · Verdict" ? "Minos · Verdict" : a.key, retry)}
            retry={retry}
          />
        );
      return i === 0 || (retry && a.key === "Hephaestus")
        ? [node]
        : [<Connector key={`c${i}${retry}`} />, node];
    });

  return (
    <div className="grid gap-6">
      <div className="lg:overflow-x-auto lg:pb-3">
        <div className="flex flex-col lg:w-max lg:flex-row lg:items-center">{lane(false)}</div>
      </div>
      {hasRetry ? (
        <div className="rounded-2xl border border-dashed border-border p-4">
          <p className="mb-3 text-sm text-ink-muted">
            Minos vetoed the first attempt; Hephaestus retried with the failure evidence.
          </p>
          <div className="lg:overflow-x-auto lg:pb-3">
            <div className="flex flex-col lg:w-max lg:flex-row lg:items-center">{lane(true)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
