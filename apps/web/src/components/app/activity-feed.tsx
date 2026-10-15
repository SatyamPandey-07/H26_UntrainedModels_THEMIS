import {
  ArrowSquareOut,
  ChartBar,
  GitMerge,
  GitPullRequest,
  Lightbulb,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ActivityItem } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS: Record<ActivityItem["status"], { label: string; className: string }> = {
  draft: { label: "Draft PR", className: "bg-surface-2 text-ink-muted" },
  open: { label: "Open", className: "bg-[var(--tag-executed-bg)] text-[color:var(--tag-executed)]" },
  merged: { label: "Merged", className: "bg-[var(--tag-ai-bg)] text-[color:var(--tag-ai)]" },
  closed: { label: "Closed", className: "bg-danger-bg text-danger" },
};

const NEW_WINDOW_MS = 15 * 60 * 1000;

function Icon({ item }: { item: ActivityItem }) {
  const cls = "shrink-0";
  if (item.kind === "pr")
    return item.status === "merged" ? (
      <GitMerge
        size={18}
        weight="bold"
        className={cn(cls, "text-[color:var(--tag-ai)]")}
        aria-hidden="true"
      />
    ) : (
      <GitPullRequest
        size={18}
        weight="bold"
        className={cn(cls, "text-[color:var(--tag-executed)]")}
        aria-hidden="true"
      />
    );
  if (item.kind === "dashboard")
    return <ChartBar size={18} weight="bold" className={cn(cls, "text-primary")} aria-hidden="true" />;
  return (
    <Lightbulb
      size={18}
      weight="bold"
      className={cn(cls, "text-[color:var(--tag-unverified)]")}
      aria-hidden="true"
    />
  );
}

/** Every issue and pull request Themis raised, linked both to its page here and to GitHub. */
export function ActivityFeed({ items, showRepo = true }: { items: ActivityItem[]; showRepo?: boolean }) {
  if (items.length === 0)
    return (
      <p className="py-6 text-sm text-ink-muted">
        Nothing yet. Issues and pull requests appear here as soon as Themis opens them.
      </p>
    );
  const now = Date.now();
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const fresh = now - Date.parse(item.at) < NEW_WINDOW_MS;
        const s = item.kind === "pr" ? STATUS[item.status] : undefined;
        return (
          <li key={item.key} className="flex items-center gap-3 py-3">
            <Icon item={item} />
            <Link href={item.href} className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-sm font-semibold">{item.title}</span>
              <span className="block truncate text-xs text-ink-muted">
                {showRepo ? `${item.repo} · ` : ""}
                {item.kind === "pr" ? "PR" : "Issue"} #{item.number} · {timeAgo(item.at)}
                {item.comments ? ` · ${item.comments} comment${item.comments === 1 ? "" : "s"}` : ""}
              </span>
            </Link>
            {fresh ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
                New
              </span>
            ) : null}
            {s ? (
              <span
                className={cn("hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:inline", s.className)}
              >
                {s.label}
              </span>
            ) : null}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${item.kind === "pr" ? "pull request" : "issue"} #${item.number} on GitHub`}
              className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <ArrowSquareOut size={16} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
