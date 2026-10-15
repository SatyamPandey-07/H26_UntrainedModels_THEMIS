import { AGENT_ROLES } from "./schema/claim.js";
import type { AgentName } from "./schema/claim.js";
import type { Concern, MigrationPlan } from "./schema/stages.js";
import { slugify } from "./util/misc.js";

/**
 * Commit and pull request wording, in Conventional Commits form. The rules are documented in the
 * `migrate-dependency` and `pr-report` skills; keep both in sync with this file.
 */

const SUBJECT_MAX = 72;

function clip(subject: string): string {
  return subject.length <= SUBJECT_MAX ? subject : `${subject.slice(0, SUBJECT_MAX - 1).trimEnd()}…`;
}

function wrap(text: string, width = 72): string {
  return text
    .split("\n")
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      for (const word of line.split(/\s+/).filter(Boolean)) {
        if (cur && cur.length + word.length + 1 > width) {
          out.push(cur);
          cur = word;
        } else cur = cur ? `${cur} ${word}` : word;
      }
      out.push(cur);
      return out.join("\n");
    })
    .join("\n");
}

/** `build(deps): upgrade svix from 2.0.0 to 2.8.0` or `build(deps): replace moment 2.29.4 with dayjs 1.11.13`. */
export function dependencySubject(
  plan: Pick<MigrationPlan, "strategy" | "dependency" | "fromVersion" | "target">,
): string {
  return clip(
    plan.strategy === "replace"
      ? `build(deps): replace ${plan.dependency} ${plan.fromVersion} with ${plan.target.name} ${plan.target.version}`
      : `build(deps): upgrade ${plan.dependency} from ${plan.fromVersion} to ${plan.target.version}`,
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export interface CommitMessageInput {
  concern: Pick<Concern, "id" | "kind" | "title" | "files" | "instructions">;
  plan: MigrationPlan;
  runId: string;
  agent?: AgentName;
  /** What actually changed, when known (model summary or command result). */
  summary?: string;
  /** Model that made the change, for model edits ("openai/gpt-oss-120b", "claude-code"). */
  model?: string;
}

/** Full commit message: subject, wrapped body, and Themis trailers. */
export function commitMessage(input: CommitMessageInput): string {
  const { concern, plan } = input;
  const scope = slugify(plan.dependency) || "deps";
  const files = concern.files.filter(Boolean);
  let subject: string;
  let why: string;
  switch (concern.kind) {
    case "toolchain":
      subject = `chore(lint): ${lowerFirst(concern.title)}`;
      why = "The repository had no linter, so the migration could not be checked for new lint violations.";
      break;
    case "dependency":
      subject = dependencySubject(plan);
      why = plan.rationale;
      break;
    case "autofix":
      subject = `refactor(${scope}): apply deterministic Opengrep fixes`;
      why =
        "Mechanical rewrites from Opengrep fix rules, applied before any model edit so the diff stays explainable.";
      break;
    case "tests":
      subject = `test(${scope}): pin current behaviour of ${plan.dependency} call sites`;
      why =
        "Characterization tests written against the old version. Only tests that passed on the base commit were kept.";
      break;
    default:
      subject = concern.id.startsWith("fix-")
        ? `fix(${scope}): ${lowerFirst(concern.title)}`
        : `refactor(${scope}): ${lowerFirst(concern.title)}`;
      why = concern.instructions;
  }
  const body = [wrap(input.summary ? `${why}\n\n${input.summary}` : why)];
  if (files.length > 0 && concern.kind !== "dependency")
    body.push(
      files
        .slice(0, 15)
        .map((f) => `- ${f}`)
        .join("\n") + (files.length > 15 ? `\n- and ${files.length - 15} more` : ""),
    );
  const agent = input.agent ?? "hephaestus";
  const trailers = [
    `Themis-Agent: ${agent[0]?.toUpperCase()}${agent.slice(1)} (${AGENT_ROLES[agent]})`,
    `Themis-Concern: ${concern.id}`,
    `Themis-Run: ${input.runId}`,
  ];
  if (input.model) trailers.push(`Themis-Model: ${input.model}`);
  return [clip(subject), "", ...body.flatMap((b) => [b, ""]), trailers.join("\n")].join("\n").trim() + "\n";
}

/** Commit that adds the capsule to the branch. */
export function capsuleCommitMessage(dependency: string, verdict: string, runId: string): string {
  return (
    [
      clip(`docs(themis): add Dependency Exit Capsule for ${dependency}`),
      "",
      wrap(
        `Verdict: ${verdict}. The capsule records every claim with how it was established and links each executed check to its log.`,
      ),
      "",
      "Themis-Agent: Clio (Capsule Writer)",
      `Themis-Run: ${runId}`,
    ].join("\n") + "\n"
  );
}

/** Draft pull request title: the dependency commit subject. */
export function pullRequestTitle(
  plan: Pick<MigrationPlan, "strategy" | "dependency" | "fromVersion" | "target">,
): string {
  return dependencySubject(plan);
}
