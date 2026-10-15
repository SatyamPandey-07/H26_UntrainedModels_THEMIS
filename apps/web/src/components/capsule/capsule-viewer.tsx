import {
  ArrowRight,
  DownloadSimple,
  GitPullRequest,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import type { Capsule, Claim } from "@themis/core";
import { buttonClass } from "../ui/button";
import { Card } from "../ui/card";
import { TagChip, VerdictChip, type Tag } from "../ui/chips";
import { ClaimsExplorer } from "./claims-explorer";

function CoverageRing({ covered, total }: { covered: number; total: number }) {
  const pct = total === 0 ? 0 : covered / total;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-24 place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div className="text-center">
        <div className="tabular text-lg font-extrabold">
          {covered}/{total}
        </div>
        <div className="text-[11px] text-ink-muted">call sites</div>
      </div>
    </div>
  );
}

function ClaimList({ claims, empty }: { claims: Claim[]; empty: string }) {
  if (claims.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="grid gap-3">
      {claims.map((c) => (
        <li key={c.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
          <TagChip tag={c.tag as Tag} className="shrink-0" />
          <span className="text-sm leading-relaxed [overflow-wrap:anywhere]">{c.text.replace(/`/g, "")}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Dependency Exit Capsule, rendered from capsule.json. Every statement carries how it was established; gaps
 * and unresolved concerns are always shown.
 */
export function CapsuleViewer({
  capsule,
  repoUrl,
  prUrl,
  capsuleUrl,
  jsonHref,
}: {
  capsule: Capsule;
  repoUrl?: string;
  prUrl?: string;
  capsuleUrl?: string;
  jsonHref?: string;
}) {
  const by = (section: string) => capsule.claims.filter((c) => c.section === section);
  const why = [...by("maintenance-problem"), ...by("risk-indicators").slice(0, 6)];
  const analysis = by("ai-analysis");
  const changes = by("proposed-changes");
  const results = by("executed-results");
  const gaps = [...by("gaps"), ...by("unresolved")];
  const tagCounts = (["OBSERVED", "EXECUTED", "AI-RECOMMENDED", "UNVERIFIED"] as const).map((t) => ({
    tag: t,
    n: capsule.claims.filter((c) => c.tag === t).length,
  }));
  const to = capsule.dependency.to?.replace(`${capsule.dependency.name}@`, "") ?? "";

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden">
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:p-8">
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">{capsule.repository}</p>
            <h1 className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xl font-bold tracking-tight md:text-4xl">
              <span className="font-mono">{capsule.dependency.name}</span>
              <span className="flex items-center gap-2 text-ink-muted">
                <span className="font-mono text-2xl">{capsule.dependency.from}</span>
                <ArrowRight size={22} aria-hidden="true" />
                <span className="font-mono text-2xl text-ink">{to || "n/a"}</span>
              </span>
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <VerdictChip verdict={capsule.verdict} size="lg" />
              <span className="rounded-full bg-surface-2 px-3 py-1.5 text-sm">
                Confidence <strong className="capitalize">{capsule.confidence}</strong>
              </span>
              {capsule.dependency.strategy ? (
                <span className="rounded-full bg-surface-2 px-3 py-1.5 text-sm capitalize">
                  {capsule.dependency.strategy}
                </span>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {prUrl ? (
                <a href={prUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
                  <GitPullRequest size={16} weight="bold" aria-hidden="true" />
                  Open draft PR
                </a>
              ) : null}
              {capsuleUrl ? (
                <a
                  href={capsuleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass("secondary", "sm")}
                >
                  View on GitHub
                </a>
              ) : null}
              {jsonHref ? (
                <a href={jsonHref} download className={buttonClass("ghost", "sm")}>
                  <DownloadSimple size={16} aria-hidden="true" />
                  capsule.json
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-5 md:flex-col md:items-end">
            <CoverageRing covered={capsule.summary.callSitesCovered} total={capsule.summary.callSites} />
            <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm md:text-right">
              <dt className="text-ink-muted">New failures</dt>
              <dd className="font-mono font-semibold">{capsule.summary.newTestFailures}</dd>
              <dt className="text-ink-muted">Lint delta</dt>
              <dd className="font-mono font-semibold">{capsule.summary.lintDelta}</dd>
              <dt className="text-ink-muted">New vulns</dt>
              <dd className="font-mono font-semibold">{capsule.summary.newSecurityFindings}</dd>
            </dl>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border bg-surface-2/60 px-6 py-3 md:px-8">
          {tagCounts.map((t) => (
            <TagChip key={t.tag} tag={t.tag} count={t.n} />
          ))}
          {capsule.downgraded.length ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-bg px-2.5 py-1 text-xs font-semibold text-danger">
              <Warning size={13} weight="bold" aria-hidden="true" />
              {capsule.downgraded.length} downgraded by the evidence gate
            </span>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card className="p-6">
          <h2 className="text-lg font-bold">Why {capsule.dependency.name}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            What Themis read from the repository and the registry.
          </p>
          <div className="mt-5">
            <ClaimList claims={why} empty="No risk signals were recorded." />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-bold">Plan and reasoning</h2>
          <p className="mt-1 text-sm text-ink-muted">What the model recommended, with the inputs it saw.</p>
          <div className="mt-5">
            <ClaimList claims={analysis} empty="No model reasoning was recorded." />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-bold">What changed</h2>
          <ol className="relative mt-5 grid gap-4 border-l border-border pl-5">
            {changes.length ? (
              changes.map((c) => (
                <li key={c.id} className="relative">
                  <span
                    className="absolute -left-[27px] top-1.5 size-3 rounded-full border-2 border-surface bg-primary"
                    aria-hidden="true"
                  />
                  <TagChip tag={c.tag as Tag} />
                  <p className="mt-1.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {c.text.replace(/`/g, "")}
                  </p>
                </li>
              ))
            ) : (
              <li className="text-sm text-ink-muted">No changes were made.</li>
            )}
          </ol>
          {capsule.filesChanged.length ? (
            <p className="mt-5 text-xs text-ink-muted">
              Files changed: <span className="font-mono">{capsule.filesChanged.join(", ")}</span>
            </p>
          ) : null}
        </Card>
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ShieldCheck size={20} weight="duotone" className="text-primary" aria-hidden="true" />
            Verification
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Default branch and this branch, built the same way in sandboxes.
          </p>
          <div className="mt-5">
            <ClaimList claims={results} empty="Verification did not run." />
          </div>
        </Card>
      </div>

      <Card className="border-[color:var(--tag-unverified)]/40 p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Warning
            size={20}
            weight="duotone"
            className="text-[color:var(--tag-unverified)]"
            aria-hidden="true"
          />
          Gaps and unresolved concerns
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Anything a test or log did not prove. Always shown.</p>
        <div className="mt-5">
          <ClaimList claims={gaps} empty="None recorded." />
        </div>
        {capsule.downgraded.length ? (
          <div className="mt-5 rounded-2xl bg-danger-bg p-4 text-sm text-danger">
            <p className="font-semibold">Downgraded by the evidence gate</p>
            <ul className="mt-2 grid gap-1">
              {capsule.downgraded.map((d) => (
                <li key={d.claimId}>
                  <span className="font-mono">{d.claimId}</span> ({d.from}): {d.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Every claim</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Filter by how each statement was established. Evidence links open the source.
        </p>
        <div className="mt-5">
          <ClaimsExplorer claims={capsule.claims} repoUrl={repoUrl} branch={capsule.branch} />
        </div>
      </Card>
    </div>
  );
}
