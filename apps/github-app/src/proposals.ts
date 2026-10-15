import type { Octokit } from "@octokit/rest";
import { riskBreakdown } from "@themis/core";
import type { DependencyFinding, Findings, MigrationPlan } from "@themis/core";
import { proposalMarker, proposalPackage } from "./dashboard.js";

/**
 * One issue per migration candidate. Themis proposes; a person decides with a comment, one step at a time:
 * `/themis plan` (read-only), then `/themis migrate` (draft PR).
 */

export const PROPOSAL_LABEL = "themis";

export function proposalTitle(d: DependencyFinding): string {
  const latest =
    d.risk.latestVersion && d.risk.latestVersion !== d.currentVersion
      ? ` (latest ${d.risk.latestVersion})`
      : "";
  const reason = d.risk.deprecated
    ? "deprecated"
    : `${d.risk.vulnerabilities.length} known vulnerabilit${d.risk.vulnerabilities.length === 1 ? "y" : "ies"}`;
  return `Themis proposal: migrate ${d.name} ${d.currentVersion}${latest}, ${reason}`;
}

export function renderProposal(d: DependencyFinding, rank: number, total: number, runUrl?: string): string {
  const breakdown = riskBreakdown(d.risk, d.currentVersion);
  const vulns = d.risk.vulnerabilities.slice(0, 10);
  return [
    proposalMarker(d.name),
    `Themis ranks \`${d.name}\` **#${rank} of ${total}** migration candidates in this repository: risk score **${d.score} / 100**${
      d.importingFiles !== undefined
        ? `, imported in ${d.importingFiles} source file${d.importingFiles === 1 ? "" : "s"}`
        : ""
    }. Nothing has changed yet.`,
    "",
    "### Why",
    "",
    "| Signal | Value | Points |",
    "|---|---|---:|",
    ...breakdown.map((c) => `| ${c.signal} | ${c.value.replace(/\|/g, "\\|")} | ${c.points} |`),
    "",
    d.rationale ? `> ${d.rationale}\n` : "",
    vulns.length
      ? [
          "<details><summary>Vulnerabilities</summary>",
          "",
          ...vulns.map(
            (v) => `- \`${v.id}\` (${v.severity}): ${v.summary}${v.fixedIn ? `, fixed in ${v.fixedIn}` : ""}`,
          ),
          "",
          "</details>",
          "",
        ].join("\n")
      : "",
    "### Next step",
    "",
    "| Comment | What happens |",
    "|---|---|",
    "| `/themis plan` | Themis maps every use of this dependency and replies with a migration plan. Read-only. |",
    "| `/themis migrate` | Themis migrates it on its own branch, verifies it against the default branch, and opens a **draft** pull request. |",
    "",
    `Not now? Close this issue. Never? Add \`${d.name}\` to \`ignore\` in \`.github/themis.yml\`.`,
    "",
    `<sub>Proposed by Themis${runUrl ? ` · [scan log](${runUrl})` : ""}. Only people with write access can run commands. Themis never merges.</sub>`,
  ]
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n");
}

/** Opens or refreshes one proposal issue per candidate; returns issue numbers keyed by package. */
export async function upsertProposals(
  octokit: Octokit,
  owner: string,
  repo: string,
  candidates: DependencyFinding[],
  total: number,
  runUrl?: string,
  skip: (d: DependencyFinding) => boolean = () => false,
): Promise<Record<string, { number: number; url: string }>> {
  const open = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    labels: PROPOSAL_LABEL,
    per_page: 100,
  });
  const existing = new Map(
    open
      .filter((i) => !i.pull_request)
      .flatMap((i) => {
        const pkg = proposalPackage(i.body);
        return pkg ? [[pkg, i] as const] : [];
      }),
  );
  const out: Record<string, { number: number; url: string }> = {};
  for (const [i, d] of candidates.entries()) {
    if (skip(d)) continue;
    const body = renderProposal(d, i + 1, total, runUrl);
    const title = proposalTitle(d);
    const found = existing.get(d.name);
    if (found) {
      await octokit.issues.update({ owner, repo, issue_number: found.number, title, body });
      out[d.name] = { number: found.number, url: found.html_url };
    } else {
      const created = await octokit.issues.create({ owner, repo, title, body, labels: [PROPOSAL_LABEL] });
      out[d.name] = { number: created.data.number, url: created.data.html_url };
    }
  }
  return out;
}

/** Comment posted after `/themis plan`: the plan, and the next step. */
export function renderPlanComment(
  plan: MigrationPlan,
  findings: Findings | undefined,
  runUrl?: string,
): string {
  const dep = findings?.dependencies.find((d) => d.name === plan.dependency);
  const verb =
    plan.strategy === "replace"
      ? `Replace \`${plan.dependency}\` ${plan.fromVersion} with \`${plan.target.name}\` ${plan.target.version}`
      : `Upgrade \`${plan.dependency}\` ${plan.fromVersion} → ${plan.target.version}`;
  return [
    `### Themis plan: ${verb}`,
    "",
    `Confidence **${plan.confidence}** · ${plan.usage.length} usage site${plan.usage.length === 1 ? "" : "s"}${dep?.importingFiles !== undefined ? ` in ${dep.importingFiles} file${dep.importingFiles === 1 ? "" : "s"}` : ""} · feasible **${plan.feasible ? "yes" : "no"}**`,
    "",
    plan.rationale,
    "",
    "**Commits Themis would make, in order**",
    "",
    ...plan.concerns.map((c, i) => `${i + 1}. \`${c.kind}\` ${c.title}`),
    plan.behavioralDifferences.length
      ? `\n**Behavioural differences to watch**\n\n${plan.behavioralDifferences.map((d) => `- ${d}`).join("\n")}`
      : "",
    "",
    plan.usage.length
      ? `<details><summary>Usage map</summary>\n\n${plan.usage
          .slice(0, 60)
          .map((s) => `- \`${s.file}:${s.line}\` ${s.symbol}`)
          .join("\n")}\n\n</details>\n`
      : "",
    "### Next step",
    "",
    plan.feasible
      ? "Comment `/themis migrate` to apply this plan on a new branch, verify it against the default branch, and open a draft pull request."
      : "Themis does not recommend this migration; the reasons are above. Close this issue, or comment `/themis migrate` to try anyway.",
    "",
    `<sub>All plan content is AI-RECOMMENDED; nothing has been changed${runUrl ? ` · [run log](${runUrl})` : ""}.</sub>`,
  ].join("\n");
}
