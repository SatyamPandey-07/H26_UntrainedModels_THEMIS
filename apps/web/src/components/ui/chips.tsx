import {
  CheckCircle,
  Eye,
  Question,
  Sparkle,
  TerminalWindow,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";

export type Tag = "OBSERVED" | "EXECUTED" | "AI-RECOMMENDED" | "UNVERIFIED";

const tagStyle: Record<Tag, { color: string; bg: string; label: string; Icon: typeof Eye }> = {
  OBSERVED: { color: "var(--tag-observed)", bg: "var(--tag-observed-bg)", label: "Observed", Icon: Eye },
  EXECUTED: {
    color: "var(--tag-executed)",
    bg: "var(--tag-executed-bg)",
    label: "Executed",
    Icon: TerminalWindow,
  },
  "AI-RECOMMENDED": {
    color: "var(--tag-ai)",
    bg: "var(--tag-ai-bg)",
    label: "AI-recommended",
    Icon: Sparkle,
  },
  UNVERIFIED: {
    color: "var(--tag-unverified)",
    bg: "var(--tag-unverified-bg)",
    label: "Unverified",
    Icon: Question,
  },
};

export function TagChip({ tag, className, count }: { tag: Tag; className?: string; count?: number }) {
  const s = tagStyle[tag];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        className,
      )}
      style={{ color: s.color, background: s.bg }}
    >
      <s.Icon size={13} weight="bold" aria-hidden="true" />
      {s.label}
      {count !== undefined ? <span className="font-mono">{count}</span> : null}
    </span>
  );
}

export type VerdictName = "Migrated and verified" | "Migrated, gaps remain" | "Not recommended";

export function VerdictChip({ verdict, size = "md" }: { verdict: string; size?: "md" | "lg" }) {
  const v = verdict as VerdictName;
  const style =
    v === "Migrated and verified"
      ? { bg: "var(--accent)", color: "var(--accent-ink)", Icon: CheckCircle }
      : v === "Migrated, gaps remain"
        ? { bg: "var(--tag-unverified-bg)", color: "var(--tag-unverified)", Icon: WarningCircle }
        : { bg: "var(--surface-2)", color: "var(--ink-muted)", Icon: XCircle };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs",
      )}
      style={{ background: style.bg, color: style.color }}
    >
      <style.Icon size={size === "lg" ? 17 : 14} weight="fill" aria-hidden="true" />
      {verdict}
    </span>
  );
}

export function StatusChip({ status, conclusion }: { status: string; conclusion: string | null }) {
  const label =
    status !== "completed"
      ? status === "queued"
        ? "Queued"
        : "Running"
      : conclusion === "success"
        ? "Succeeded"
        : conclusion === "skipped"
          ? "Skipped"
          : conclusion === "cancelled"
            ? "Cancelled"
            : "Failed";
  const tone =
    label === "Succeeded"
      ? { color: "var(--tag-executed)", bg: "var(--tag-executed-bg)" }
      : label === "Running" || label === "Queued"
        ? { color: "var(--tag-observed)", bg: "var(--tag-observed-bg)" }
        : label === "Skipped" || label === "Cancelled"
          ? { color: "var(--ink-muted)", bg: "var(--surface-2)" }
          : { color: "var(--danger)", bg: "var(--danger-bg)" };
  return (
    <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold" style={tone}>
      {label}
    </span>
  );
}
