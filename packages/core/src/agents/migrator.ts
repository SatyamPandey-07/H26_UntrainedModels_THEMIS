import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ClaimBook } from "../evidence/claims.js";
import { runCommand } from "../evidence/command.js";
import type { CommandResult } from "../evidence/command.js";
import type { LlmClient } from "../llm/client.js";
import type { RunContext } from "../run/context.js";
import { logEvent, resolveRunPath, writeJson } from "../run/context.js";
import type { Sandbox } from "../sandbox/sandbox.js";
import { singleTestCommand } from "../sandbox/tests.js";
import type { Concern, Findings, MigrationPlan, MigrationResult, Toolchain } from "../schema/stages.js";
import { MigrationResult as MigrationResultSchema } from "../schema/stages.js";
import { readSkillFile } from "../skills/loader.js";
import { addWorktree, branchExists, commitFiles, dirtyFiles, trackedFiles } from "../tools/git.js";
import { opengrepAutofix, opengrepAvailable } from "../tools/opengrep.js";
import { slugify } from "../util/misc.js";
import { runAgent } from "./base.js";
import { editTools, readOnlyTools } from "./fs-tools.js";

export interface VerifierFeedback {
  reasons: string[];
  failingTests: string[];
  logTails: Array<{ logPath: string; tail: string }>;
}

export interface MigratorInput {
  findings: Findings;
  plan: MigrationPlan;
  sandbox: Sandbox;
  attempt: number;
  previous?: MigrationResult;
  feedback?: VerifierFeedback;
}

const EditSummary = z.object({
  summary: z.string().describe("What changed in each file, one line per file."),
  unresolved: z
    .array(z.string())
    .default([])
    .describe("Call sites you could not migrate safely, with reasons."),
});

const TestDraft = z.object({
  files: z.array(z.string()).min(1).describe("Paths of the characterization test files you wrote."),
  notes: z.string().default(""),
});

const MINIMAL_ESLINT_CONFIG = `import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**", ".next/**", ".themis/**"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-undef": "off" },
  },
];
`;

export function lockfileFor(pm: Toolchain["packageManager"]): string {
  return pm === "pnpm" ? "pnpm-lock.yaml" : pm === "yarn" ? "yarn.lock" : "package-lock.json";
}

/** Package manager invocations that only touch the manifest and lockfile (no install, no scripts). */
function pmCommand(
  pm: Toolchain["packageManager"],
  action: "add" | "remove",
  specs: string[],
  dev: boolean,
): string[] {
  if (pm === "pnpm")
    return action === "add"
      ? ["pnpm", "add", "--lockfile-only", "--ignore-scripts", ...(dev ? ["-D"] : []), ...specs]
      : ["pnpm", "remove", "--lockfile-only", ...specs];
  if (pm === "yarn")
    return action === "add"
      ? ["yarn", "add", "--mode", "update-lockfile", ...(dev ? ["-D"] : []), ...specs]
      : ["yarn", "remove", "--mode", "update-lockfile", ...specs];
  return action === "add"
    ? [
        "npm",
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...(dev ? ["--save-dev"] : []),
        ...specs,
      ]
    : ["npm", "uninstall", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", ...specs];
}

function branchName(dependency: string, now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `themis/${slugify(dependency)}-${d}`;
}

function isCharacterizationTest(path: string, slug: string): boolean {
  return new RegExp(`(^|/)themis-${slug}\\.characterization\\.test\\.[cm]?[jt]sx?$`).test(path);
}

/** Hephaestus: applies the plan on a dedicated branch, one commit per concern. Never touches the base branch. */
export async function runMigrator(
  ctx: RunContext,
  llm: LlmClient,
  input: MigratorInput,
): Promise<MigrationResult> {
  const { findings, plan, sandbox, attempt } = input;
  const book = new ClaimBook("hephaestus");
  const slug = slugify(plan.dependency);
  const toolchain = findings.toolchain;
  const pm = toolchain.packageManager;
  const lockfile = lockfileFor(pm);
  const dependencyFinding = findings.dependencies.find((d) => d.name === plan.dependency);
  const branch = input.previous?.branch ?? branchName(plan.dependency);
  const worktree = input.previous?.worktreePath ?? join(tmpdir(), "themis-worktrees", ctx.runId);
  const commits: MigrationResult["commits"] = [...(input.previous?.commits ?? [])];
  let keptTests = [...(input.previous?.keptTests ?? [])];
  const discardedTests = [...(input.previous?.discardedTests ?? [])];

  if (!input.previous) {
    if (await branchExists(ctx.repoPath, branch))
      logEvent(ctx, `hephaestus: branch ${branch} exists locally and will be reset from the base commit`);
    mkdirSync(join(tmpdir(), "themis-worktrees"), { recursive: true });
    rmSync(worktree, { recursive: true, force: true });
    const wt = await addWorktree(ctx, ctx.repoPath, worktree, branch, findings.baseCommit);
    if (wt.exitCode !== 0) throw new Error(`could not create worktree for ${branch}; see ${wt.logPath}`);
    book.executed(
      "proposed-changes",
      `Created branch \`${branch}\` from ${findings.baseCommit.slice(0, 7)} in a separate worktree`,
      wt,
    );
  }

  const commit = async (concern: Pick<Concern, "id" | "kind" | "title">, files: string[]) => {
    const sha = await commitFiles(ctx, worktree, files, `themis(${concern.kind}): ${concern.title}`);
    if (sha) {
      commits.push({ sha, concernId: concern.id, message: `themis(${concern.kind}): ${concern.title}` });
      logEvent(ctx, `hephaestus: committed ${concern.id} as ${sha.slice(0, 7)}`);
    }
    return sha;
  };

  const runPm = async (label: string, argv: string[]): Promise<CommandResult> =>
    runCommand(ctx, {
      label,
      file: argv[0] as string,
      args: argv.slice(1),
      cwd: worktree,
      env: { HUSKY: "0" },
      timeoutMs: 600_000,
    });

  const reference = (() => {
    try {
      return readSkillFile("migrate-dependency", `references/${slug}-to-${slugify(plan.target.name)}.md`);
    } catch {
      return undefined;
    }
  })();

  const modelEdit = async (concern: Concern, extraTask = "") => {
    const allowed = new Set(concern.files);
    const written = new Set<string>();
    const sites = plan.usage.filter((s) => allowed.has(s.file));
    const data: Record<string, string> = {
      "concern.json": JSON.stringify(concern, null, 2),
      "call-sites.json": JSON.stringify(sites, null, 2),
      "behavioural-differences.md":
        plan.behavioralDifferences.map((d) => `- ${d}`).join("\n") || "(none listed)",
    };
    if (reference) data["migration-reference.md"] = reference;
    if (input.feedback) data["verifier-feedback.json"] = JSON.stringify(input.feedback, null, 2);
    const result = await runAgent(ctx, llm, {
      agent: "hephaestus",
      label: `${concern.id}-a${attempt}`,
      task: [
        `Migrate ${plan.dependency} to ${plan.target.name}@${plan.target.version} in: ${concern.files.join(", ")}.`,
        "Follow the concern instructions. Read each file before editing. Change only the listed call sites and the import.",
        extraTask,
      ]
        .filter(Boolean)
        .join(" "),
      data,
      tools: [
        ...readOnlyTools(worktree),
        ...editTools(
          worktree,
          (p) => allowed.has(p),
          (p) => written.add(p),
        ),
      ],
      output: EditSummary,
      outputDescription: "Submit a summary of your edits and any call sites left unresolved.",
      maxSteps: 24,
    });
    const sha = await commit(concern, [...written]);
    if (sha)
      book.recommended(
        "proposed-changes",
        `${concern.title} (${sha.slice(0, 7)}): ${result.output.summary}`,
        result.model,
        result.inputs,
      );
    else
      book.unverified("gaps", `Concern "${concern.title}" produced no file changes`, "model made no edits");
    for (const u of result.output.unresolved)
      book.unverified("unresolved", u, "Migrator could not migrate this call site");
  };

  if (attempt === 0) {
    for (const concern of plan.concerns) {
      if (concern.kind === "toolchain") {
        writeFileSync(join(worktree, "eslint.config.mjs"), MINIMAL_ESLINT_CONFIG);
        const r = await runPm("pm-add-eslint", pmCommand(pm, "add", ["eslint@^9", "@eslint/js@^9"], true));
        if (r.exitCode === 0) {
          await commit(concern, ["eslint.config.mjs", "package.json", lockfile]);
          book.executed(
            "proposed-changes",
            "Added a minimal ESLint configuration and its dev dependencies",
            r,
          );
        } else
          book.unverified(
            "gaps",
            "Could not add ESLint dev dependencies; lint config skipped",
            `see ${r.logPath}`,
          );
      } else if (concern.kind === "dependency") {
        const dev = dependencyFinding?.dev ?? false;
        const spec = `${plan.target.name}@${plan.target.version}`;
        let ok = true;
        if (plan.strategy === "replace") {
          const rm = await runPm("pm-remove", pmCommand(pm, "remove", [plan.dependency], dev));
          ok = rm.exitCode === 0;
          if (ok)
            book.executed(
              "proposed-changes",
              `Removed \`${plan.dependency}\` from the manifest and lockfile`,
              rm,
            );
          else book.unverified("unresolved", `Removing ${plan.dependency} failed`, `see ${rm.logPath}`);
        }
        const add = await runPm("pm-add", pmCommand(pm, "add", [spec], dev));
        if (add.exitCode === 0 && ok) {
          await commit(concern, ["package.json", lockfile]);
          book.executed("proposed-changes", `Added \`${spec}\` to the manifest and lockfile`, add);
        } else {
          book.unverified("unresolved", `Dependency change to ${spec} failed`, `see ${add.logPath}`);
          throw new Error(`dependency change failed; see ${add.logPath}`);
        }
      } else if (concern.kind === "autofix") {
        const fixRule = plan.rules.find((r) => r.hasFix);
        if (!fixRule || !(await opengrepAvailable(ctx))) {
          book.unverified(
            "gaps",
            "Autofix rules were not applied (opengrep unavailable or no fix rules)",
            "autofix skipped",
          );
          continue;
        }
        const r = await opengrepAutofix(ctx, worktree, resolveRunPath(ctx, fixRule.path));
        const changed = (await dirtyFiles(worktree)).filter((f) => !f.startsWith(".themis/"));
        const sha = await commit(concern, changed);
        if (sha)
          book.executed(
            "proposed-changes",
            `Opengrep autofix rewrote ${changed.length} file(s): ${changed.join(", ")}`,
            r,
          );
      } else if (concern.kind === "model-edit") {
        await modelEdit(concern);
      } else if (concern.kind === "tests") {
        keptTests = await generateCharacterizationTests(ctx, llm, {
          worktree,
          plan,
          concern,
          toolchain,
          sandbox,
          baseCommit: findings.baseCommit,
          book,
          discarded: discardedTests,
          commit,
        });
      }
    }
  } else {
    // Retry: one fix pass across the migrated files, driven by the Verifier's findings.
    const files = [
      ...new Set([
        ...plan.usage.map((s) => s.file),
        ...plan.concerns.filter((c) => c.kind === "model-edit").flatMap((c) => c.files),
      ]),
    ];
    await modelEdit(
      {
        id: `fix-${attempt}`,
        kind: "model-edit",
        title: `address verifier findings (attempt ${attempt})`,
        files,
        instructions:
          "Fix the causes listed in verifier-feedback.json without editing characterization tests.",
      },
      "Fix the failures described in verifier-feedback.json. Never edit or delete characterization tests.",
    );
  }

  const result: MigrationResult = MigrationResultSchema.parse({
    branch,
    worktreePath: worktree,
    baseCommit: findings.baseCommit,
    commits,
    keptTests,
    discardedTests,
    attempt,
    claims: book.claims,
  });
  writeJson(ctx, `migration-attempt-${attempt}.json`, result);
  writeJson(ctx, "migration.json", result);
  return result;
}

interface TestGenInput {
  worktree: string;
  plan: MigrationPlan;
  concern: Concern;
  toolchain: Toolchain;
  sandbox: Sandbox;
  baseCommit: string;
  book: ClaimBook;
  discarded: MigrationResult["discardedTests"];
  commit: (concern: Pick<Concern, "id" | "kind" | "title">, files: string[]) => Promise<string | undefined>;
}

/**
 * Writes characterization tests for touched call sites, runs each on the base commit in the sandbox, keeps only
 * the ones that pass on the old dependency and discards the rest into the gaps list (F6).
 */
async function generateCharacterizationTests(
  ctx: RunContext,
  llm: LlmClient,
  t: TestGenInput,
): Promise<string[]> {
  const slug = slugify(t.plan.dependency);
  const written = new Set<string>();
  const all = await trackedFiles(t.worktree);
  const existingTests = all.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)).slice(0, 40);
  const result = await runAgent(ctx, llm, {
    agent: "hephaestus",
    label: "characterization-tests",
    task: [
      `Write characterization tests that pin the CURRENT behaviour of the project functions that use ${t.plan.dependency}.`,
      `Name each file themis-${slug}.characterization.test.<ext> and place it next to existing tests so the`,
      `${t.toolchain.testRunner ?? "project"} runner picks it up. Each test name must start with the call site as`,
      "file:line. Import project modules, never the dependency directly. Use fixed inputs only.",
    ].join(" "),
    data: {
      "call-sites.json": JSON.stringify(t.plan.usage, null, 2),
      "suggested-tests.md": t.concern.instructions,
      "toolchain.json": JSON.stringify(t.toolchain, null, 2),
      "existing-test-files.txt": existingTests.join("\n") || "(no existing tests)",
      "test-shapes.md": readSkillFile("characterization-tests", "references/test-shapes.md"),
    },
    tools: [
      ...readOnlyTools(t.worktree),
      ...editTools(
        t.worktree,
        (p) => isCharacterizationTest(p, slug),
        (p) => written.add(p),
      ),
    ],
    output: TestDraft,
    outputDescription: "Submit the list of test files you wrote.",
    maxSteps: 24,
  });
  t.book.recommended(
    "suggested-tests",
    `Generated ${written.size} characterization test file(s): ${[...written].join(", ")}. ${result.output.notes}`,
    result.model,
    result.inputs,
  );

  const files = [...written].filter((f) => existsSync(join(t.worktree, f)));
  if (files.length === 0) {
    t.book.unverified("gaps", "No characterization tests were produced", "model wrote no test files");
    return [];
  }

  const baseline = await t.sandbox.prepare(ctx, "baseline", t.baseCommit);
  if (baseline.install.exitCode !== 0) {
    for (const f of files) {
      rmSync(join(t.worktree, f), { force: true });
      t.discarded.push({
        file: f,
        reason: "baseline install failed, so the test could not be validated",
        logPath: baseline.install.logPath,
      });
    }
    t.book.unverified(
      "gaps",
      "Characterization tests could not be validated because the baseline install failed",
      `see ${baseline.install.logPath}`,
    );
    return [];
  }

  const kept: string[] = [];
  for (const f of files) {
    const r = await t.sandbox.exec(ctx, baseline, singleTestCommand(t.toolchain, f), {
      label: `chartest-${slugify(f).slice(-40)}`,
      mounts: { [join(t.worktree, f)]: f },
      timeoutMs: 10 * 60_000,
    });
    if (r.exitCode === 0) {
      kept.push(f);
      t.book.executed(
        "suggested-tests",
        `Characterization test \`${f}\` passes on the base commit (old dependency) and is kept`,
        r,
      );
    } else {
      rmSync(join(t.worktree, f), { force: true });
      t.discarded.push({
        file: f,
        reason: "fails on the base commit with the old dependency",
        logPath: r.logPath,
      });
      t.book.executed(
        "gaps",
        `Characterization test \`${f}\` failed on the base commit and was discarded`,
        r,
      );
    }
  }
  if (kept.length > 0) await t.commit(t.concern, kept);
  return kept;
}
