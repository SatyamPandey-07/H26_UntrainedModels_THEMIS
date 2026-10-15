import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { RunSummary } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { StatusChip } from "../ui/chips";

const MODE: Record<string, string> = { scan: "Scan", plan: "Plan", run: "Migrate" };

export function RunList({ runs }: { runs: RunSummary[] }) {
  return (
    <ul className="divide-y divide-border">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <span className="w-16 shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-center text-xs font-semibold">
            {MODE[r.mode] ?? r.mode}
          </span>
          <Link href={`/runs/${r.id}`} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate font-mono text-sm">
              {r.pkg === "-" || r.pkg === "recommended" ? r.repository : `${r.pkg}`}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              {r.repository} · {timeAgo(r.createdAt)}
            </span>
          </Link>
          <StatusChip status={r.status} conclusion={r.conclusion} />
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on GitHub Actions"
            className="text-ink-muted hover:text-ink"
          >
            <ArrowSquareOut size={16} />
          </a>
        </li>
      ))}
    </ul>
  );
}
