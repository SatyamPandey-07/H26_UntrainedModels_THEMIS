"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import type { Claim } from "@themis/core";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { TagChip, type Tag } from "../ui/chips";

const TAGS: Tag[] = ["OBSERVED", "EXECUTED", "AI-RECOMMENDED", "UNVERIFIED"];
const AGENT: Record<string, string> = {
  hermes: "Hermes",
  argus: "Argus",
  athena: "Athena",
  hephaestus: "Hephaestus",
  minos: "Minos",
  clio: "Clio",
};

function Evidence({ claim, repoUrl, branch }: { claim: Claim; repoUrl?: string; branch?: string }) {
  const ev = claim.evidence;
  if (ev.kind === "source") {
    if (ev.file && repoUrl) {
      const href = `${repoUrl}/blob/${branch ?? "HEAD"}/${ev.file}${ev.line ? `#L${ev.line}` : ""}`;
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
        >
          {ev.file}
          {ev.line ? `:${ev.line}` : ""}
          <ArrowSquareOut size={12} aria-hidden="true" />
        </a>
      );
    }
    if (ev.url)
      return (
        <a
          href={ev.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 break-all text-primary hover:underline"
        >
          {ev.url.replace(/^https?:\/\//, "")}
          <ArrowSquareOut size={12} aria-hidden="true" />
        </a>
      );
    return <span className="font-mono">{ev.file}</span>;
  }
  if (ev.kind === "command")
    return (
      <span className="font-mono">
        <span className="text-ink">
          {ev.command.length > 90 ? `${ev.command.slice(0, 87)}...` : ev.command}
        </span>
        <span className="text-ink-muted">
          {" "}
          exit {ev.exitCode} · {ev.logPath}
        </span>
      </span>
    );
  if (ev.kind === "model")
    return (
      <span>
        <span className="font-mono">{ev.model}</span>
        <span className="text-ink-muted"> read {ev.inputs.join(", ") || "no inputs"}</span>
      </span>
    );
  return <span className="text-ink-muted">{ev.reason}</span>;
}

/** Every claim with its provenance tag, filterable, each linked to its evidence. */
export function ClaimsExplorer({
  claims,
  repoUrl,
  branch,
}: {
  claims: Claim[];
  repoUrl?: string;
  branch?: string;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<Tag | "ALL">("ALL");
  const counts = useMemo(
    () =>
      Object.fromEntries(TAGS.map((t) => [t, claims.filter((c) => c.tag === t).length])) as Record<
        Tag,
        number
      >,
    [claims],
  );
  const shown = active === "ALL" ? claims : claims.filter((c) => c.tag === active);

  return (
    <div>
      <div role="tablist" aria-label="Filter claims by provenance" className="flex flex-wrap gap-2">
        <button
          role="tab"
          aria-selected={active === "ALL"}
          onClick={() => setActive("ALL")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
            active === "ALL"
              ? "border-primary bg-primary text-white dark:text-[#120c2b]"
              : "border-border text-ink-muted hover:text-ink",
          )}
        >
          All <span className="font-mono">{claims.length}</span>
        </button>
        {TAGS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            onClick={() => setActive(t)}
            className={cn(
              "rounded-full ring-2 ring-transparent transition",
              active === t && "ring-[var(--focus)]",
            )}
          >
            <TagChip tag={t} count={counts[t]} />
          </button>
        ))}
      </div>
      <ul className="mt-5 grid gap-2">
        {shown.map((c, i) => (
          <motion.li
            key={c.id}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.25 }}
            className="grid gap-2 rounded-2xl border border-border bg-surface px-4 py-3 sm:grid-cols-[150px_1fr]"
          >
            <div className="flex flex-wrap items-start gap-2 sm:flex-col">
              <TagChip tag={c.tag as Tag} />
              <span className="text-xs text-ink-muted">{AGENT[c.agent] ?? c.agent}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{c.text.replace(/`/g, "")}</p>
              <p className="mt-1 text-xs [overflow-wrap:anywhere]">
                <Evidence claim={c} repoUrl={repoUrl} branch={branch} />
              </p>
            </div>
          </motion.li>
        ))}
        {shown.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
            No claims with this tag.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
