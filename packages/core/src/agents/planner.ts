import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { ClaimBook } from "../evidence/claims.js";
import type { LlmClient } from "../llm/client.js";
import type { RunContext } from "../run/context.js";
import { logEvent, writeJson } from "../run/context.js";
import type { Concern, DependencyFinding, Findings, MigrationPlan, UsageSite } from "../schema/stages.js";
import { MigrationPlan as MigrationPlanSchema } from "../schema/stages.js";
import { findSkillsDir, readSkillFile } from "../skills/loader.js";
import { trackedFiles } from "../tools/git.js";
import { dedupeSites, opengrepAvailable, opengrepMapper } from "../tools/opengrep.js";
import { ecosystemFor } from "../ecosystems/index.js";
import { importRule } from "../ecosystems/node/rules.js";
import { slugify } from "../util/misc.js";
import { runAgent } from "./base.js";
import { readOnlyTools } from "./fs-tools.js";

export interface RuleFile {
  rules: Array<Record<string, unknown> & { id: string }>;
}

const RulesDraft = z.object({
  usageRulesYaml: z
    .string()
    .describe("Opengrep YAML with a top-level `rules:` list of usage rules (no fix)."),
  fixRulesYaml: z
    .string()
    .optional()
    .describe("Opengrep YAML with fix rules, only for purely mechanical rewrites. Omit when unsure."),
});

export const PlanDraft = z.object({
  strategy: z.enum(["upgrade", "replace"]),
  target: z.object({ name: z.string(), version: z.string() }),
  rationale: z.string(),
  behavioralDifferences: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  feasible: z.boolean(),
  infeasibleReasons: z.array(z.string()).default([]),
  modelEditConcerns: z
    .array(z.object({ title: z.string(), files: z.array(z.string()).min(1), instructions: z.string() }))
    .default([]),
  suggestedTests: z
    .array(z.string())
    .describe("Call sites (file:line symbol) that characterization tests should pin."),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

export { importRule };

export function parseRules(
  yamlText: string,
  pkg: string,
  languages: string[] = ["javascript", "typescript"],
): { rules?: RuleFile; error?: string } {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText.replace(/^```(?:ya?ml)?\s*|\s*```\s*$/g, ""));
  } catch (err) {
    return { error: `YAML does not parse: ${(err as Error).message}` };
  }
  const rules = (doc as RuleFile | undefined)?.rules;
  if (!Array.isArray(rules) || rules.length === 0)
    return { error: "YAML must have a non-empty top-level `rules:` list" };
  const prefix = `themis-${slugify(pkg)}-`;
  for (const r of rules) {
    if (typeof r?.id !== "string" || !r.id.startsWith(prefix))
      return { error: `every rule id must start with "${prefix}"` };
    if (!r.languages) r.languages = languages;
  }
  return { rules: { rules } };
}

export function writeRules(ctx: RunContext, name: string, rules: RuleFile): string {
  const dir = join(ctx.runDir, "rules");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, stringifyYaml(rules));
  return path;
}

/** Reference guides bundled with migrate-dependency, e.g. moment-to-dayjs.md for `moment`. */
function migrationReference(pkg: string): string | undefined {
  const dir = join(findSkillsDir(), "migrate-dependency", "references");
  if (!existsSync(dir)) return undefined;
  const file = readdirSync(dir).find((f) => f.startsWith(`${slugify(pkg)}-to-`));
  return file ? readSkillFile("migrate-dependency", `references/${file}`) : undefined;
}

function chooseDependency(
  findings: Findings,
  requested?: string,
  normalize: (name: string) => string = (n) => n,
): DependencyFinding {
  if (requested) {
    const dep =
      findings.dependencies.find((d) => d.name === requested) ??
      findings.dependencies.find((d) => normalize(d.name) === normalize(requested));
    if (!dep) throw new Error(`${requested} is not a direct dependency of this repository`);
    return dep;
  }
  const dep = findings.dependencies[0];
  if (!dep) throw new Error("the repository has no direct dependencies to migrate");
  return dep;
}

export interface PlannerResult {
  plan: MigrationPlan;
  usageRulesPath: string;
  fixRulesPath?: string;
}

/** Athena: usage map from Opengrep rules, then a migration plan. Reads only. */
export async function runPlanner(
  ctx: RunContext,
  llm: LlmClient,
  findings: Findings,
  requested?: string,
): Promise<PlannerResult> {
  const repoPath = ctx.repoPath;
  const book = new ClaimBook("athena");
  const eco = ecosystemFor(findings.toolchain);
  const dep = chooseDependency(findings, requested, eco.normalizeName);
  const pkg = dep.name;
  const slug = slugify(pkg);
  logEvent(ctx, `athena: planning ${pkg}@${dep.currentVersion}`);

  const files = await trackedFiles(repoPath);
  const regexSites = eco.regexUsageMap(repoPath, files, pkg);
  const importingFiles = [...new Set(regexSites.map((s) => s.file))];

  // 1. Rules: deterministic import rule plus model-written call and fix rules.
  const baseRules = eco.importRule(pkg);
  const ruleTask = [
    `Write Opengrep rules for the ${eco.labels.packageNoun} "${pkg}". The import rule already exists; write usage rules that match`,
    "every call made through the imported binding in the files listed, and fix rules only for purely mechanical",
    `rewrites. Rule ids must start with "themis-${slug}-". Read the files with the tools before writing patterns.`,
  ].join(" ");
  const ruleData = {
    "importing-files.txt": importingFiles.join("\n") || "(none found by text search)",
    "existing-import-rule.yaml": stringifyYaml(baseRules),
    ...eco.promptContext(pkg, repoPath, files),
  };

  let usageRules: RuleFile = baseRules;
  let fixRules: RuleFile | undefined;
  let usage: UsageSite[] = [];
  let mapperNote = "";
  const useOpengrep = await opengrepAvailable(ctx);

  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const drafted = await runAgent(ctx, llm, {
      agent: "athena",
      label: `rules-${attempt}`,
      task: feedback ? `${ruleTask}\n\nYour previous rules failed: ${feedback}` : ruleTask,
      data: ruleData,
      tools: readOnlyTools(repoPath),
      output: RulesDraft,
      outputDescription: "Submit the usage rules YAML and, optionally, fix rules YAML.",
      maxSteps: 12,
    });
    const parsedUsage = parseRules(drafted.output.usageRulesYaml, pkg, eco.ruleLanguages);
    const parsedFix = drafted.output.fixRulesYaml
      ? parseRules(drafted.output.fixRulesYaml, pkg, eco.ruleLanguages)
      : undefined;
    if (parsedUsage.error) {
      feedback = parsedUsage.error;
      continue;
    }
    usageRules = { rules: [...baseRules.rules, ...(parsedUsage.rules?.rules ?? [])] };
    fixRules = parsedFix?.rules;
    if (parsedFix?.error)
      book.unverified("gaps", `Fix rules were discarded: ${parsedFix.error}`, "invalid fix rules");

    if (!useOpengrep) break;
    const outcome = await opengrepMapper.map(
      ctx,
      repoPath,
      writeRules(ctx, `${slug}-usage.yaml`, usageRules),
      eco.opengrepExcludes,
    );
    if (outcome.ok) {
      usage = outcome.data;
      const missed = importingFiles.filter((f) => !usage.some((s) => s.file === f));
      if (missed.length === 0 || attempt === 1) {
        book.executed(
          "usage-locations",
          `Opengrep found ${usage.length} usage site(s) of \`${pkg}\``,
          outcome,
        );
        if (missed.length > 0)
          mapperNote = `Opengrep rules missed imports in: ${missed.join(", ")}; regex matches added.`;
        break;
      }
      feedback = `the rules matched nothing in these files that import ${pkg}: ${missed.join(", ")}`;
    } else {
      feedback = outcome.reason;
      if (attempt === 1)
        mapperNote = `Opengrep could not run the rules (${outcome.reason}); regex mapping used.`;
    }
  }

  const usageRulesPath = writeRules(ctx, `${slug}-usage.yaml`, usageRules);
  const fixRulesPath = fixRules ? writeRules(ctx, `${slug}-fix.yaml`, fixRules) : undefined;

  if (!useOpengrep) mapperNote = "Opengrep is not installed; usage was mapped with the regex fallback.";
  if (mapperNote) {
    const covered = new Set(usage.map((s) => s.file));
    usage = dedupeSites([...usage, ...regexSites.filter((s) => !covered.has(s.file) || !useOpengrep)]);
    book.unverified("gaps", mapperNote, "usage map partially produced by regex matching");
  }
  for (const s of usage.slice(0, 200)) {
    book.observed("usage-locations", `${s.file}:${s.line} \`${s.symbol}\` (${s.ruleId})`, {
      file: s.file,
      line: s.line,
    });
  }
  if (usage.length === 0)
    book.unverified("gaps", `No usage of \`${pkg}\` was found in tracked source files.`, "empty usage map");

  // 2. Migration plan.
  const reference = migrationReference(pkg);
  const planData: Record<string, string> = {
    "dependency.json": JSON.stringify(dep, null, 2),
    "usage-map.json": JSON.stringify(usage, null, 2),
    "toolchain.json": JSON.stringify(findings.toolchain, null, 2),
  };
  if (fixRules) planData["fix-rules.yaml"] = stringifyYaml(fixRules);
  if (reference) planData["migration-reference.md"] = reference;

  const planTask = [
    `Plan the migration of "${pkg}" (installed ${dep.currentVersion}).`,
    `Decide upgrade or replace, pick a concrete target version that exists on ${eco.labels.registry}, list behavioural differences`,
    "for the calls in the usage map, and write model-edit concerns (one per file or tightly coupled group) whose",
    "instructions name each call site and its replacement. Call sites covered by the fix rules need no model edit.",
    "Set feasible=false with reasons if behaviour cannot be preserved.",
  ].join(" ");

  let draft: PlanDraft | undefined;
  let planModel = llm.model;
  let planInputs: string[] = Object.keys(planData);
  let planFeedback = "";
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    const result = await runAgent(ctx, llm, {
      agent: "athena",
      label: `plan-${attempt}`,
      task: planFeedback ? `${planTask}\n\nCorrection needed: ${planFeedback}` : planTask,
      data: planData,
      tools: readOnlyTools(repoPath),
      output: PlanDraft,
      outputDescription: "Submit the migration plan.",
      maxSteps: 14,
    });
    planModel = result.model;
    planInputs = result.inputs;
    const target = await eco.registryInfo(result.output.target.name);
    if (!target)
      planFeedback = `package "${result.output.target.name}" does not exist on ${eco.labels.registry}`;
    else if (!target.versionExists(result.output.target.version))
      planFeedback = `version ${result.output.target.version} of ${result.output.target.name} does not exist; latest is ${target.latestVersion}`;
    else draft = result.output;
    if (planFeedback && attempt === 1) {
      draft = {
        ...result.output,
        feasible: false,
        infeasibleReasons: [...result.output.infeasibleReasons, planFeedback],
      };
      book.unverified(
        "unresolved",
        `Planner target could not be confirmed on ${eco.labels.registry}: ${planFeedback}`,
        "registry check failed",
      );
    }
  }
  if (!draft) throw new Error("planner produced no plan");

  return finalizePlan(ctx, {
    findings,
    dep,
    usage,
    files,
    usageRules,
    fixRules,
    usageRulesPath,
    fixRulesPath,
    draft,
    model: planModel,
    inputs: planInputs,
    book,
  });
}

export interface FinalizePlanInput {
  findings: Findings;
  dep: DependencyFinding;
  usage: UsageSite[];
  /** Files tracked in git; concern files outside this list are dropped. */
  files: string[];
  usageRules: RuleFile;
  fixRules?: RuleFile;
  usageRulesPath: string;
  fixRulesPath?: string;
  draft: PlanDraft;
  /** Model that wrote the draft (Groq model id, or "claude-code" in plugin mode). */
  model: string;
  inputs: string[];
  book: ClaimBook;
}

/**
 * Deterministic second half of planning, shared by the Groq planner and the plugin's `plan --from` step:
 * orders concerns, records every model decision as AI-RECOMMENDED, and writes plan.json.
 */
export function finalizePlan(ctx: RunContext, input: FinalizePlanInput): PlannerResult {
  const { findings, dep, usage, files, usageRules, fixRules, usageRulesPath, fixRulesPath, draft, book } =
    input;
  const planModel = input.model;
  const planInputs = input.inputs;
  const pkg = dep.name;
  const eco = ecosystemFor(findings.toolchain);
  // 3. Concerns in the fixed order the Migrator commits them.
  const usageFiles = new Set(usage.map((s) => s.file));
  const concerns: Concern[] = [];
  if (findings.toolchain.lintConfigProposed)
    concerns.push({
      id: "toolchain",
      kind: "toolchain",
      title: "add a minimal lint configuration",
      files: eco.lintConcern.files,
      instructions: eco.lintConcern.instructions,
    });
  concerns.push({
    id: "dependency",
    kind: "dependency",
    title:
      draft.strategy === "replace"
        ? `replace ${pkg} with ${draft.target.name}@${draft.target.version}`
        : `upgrade ${pkg} to ${draft.target.version}`,
    files: eco.planManifestFiles(findings.toolchain),
    instructions: `${draft.strategy} ${pkg} -> ${draft.target.name}@${draft.target.version}`,
  });
  if (fixRules)
    concerns.push({
      id: "autofix",
      kind: "autofix",
      title: "apply deterministic Opengrep fixes",
      files: [...usageFiles],
      instructions: `opengrep --autofix with ${relative(ctx.runDir, fixRulesPath as string)}`,
    });
  draft.modelEditConcerns.forEach((c, i) => {
    const kept = c.files.filter((f) => files.includes(f));
    const dropped = c.files.filter((f) => !files.includes(f));
    if (dropped.length > 0)
      book.unverified(
        "gaps",
        `Planner named files that do not exist: ${dropped.join(", ")}`,
        "files not tracked in git",
      );
    if (kept.length > 0)
      concerns.push({
        id: `edit-${i + 1}`,
        kind: "model-edit",
        title: c.title,
        files: kept,
        instructions: c.instructions,
      });
  });
  concerns.push({
    id: "tests",
    kind: "tests",
    title: `characterization tests for ${pkg} call sites`,
    files: [...usageFiles],
    instructions: `Pin current behaviour of: ${draft.suggestedTests.join("; ") || "every touched call site"}`,
  });

  // 4. Claims: everything the model decided is AI-RECOMMENDED.
  book.observed(
    "maintenance-problem",
    `\`${pkg}\` ranks with risk score ${dep.score}${dep.risk.deprecated ? " and is deprecated" : ""}`,
    {
      url: eco.registryUrl(pkg),
    },
  );
  book.recommended(
    "ai-analysis",
    `${draft.strategy === "replace" ? "Replace" : "Upgrade"} \`${pkg}\` with \`${draft.target.name}@${draft.target.version}\` (confidence: ${draft.confidence}). ${draft.rationale}`,
    planModel,
    planInputs,
  );
  for (const d of draft.behavioralDifferences)
    book.recommended("ai-analysis", `Behavioural difference: ${d}`, planModel, planInputs);
  if (!draft.feasible)
    for (const r of draft.infeasibleReasons)
      book.recommended("ai-analysis", `Not feasible: ${r}`, planModel, planInputs);
  for (const c of concerns)
    book.recommended(
      "proposed-changes",
      `${c.kind}: ${c.title} (${c.files.join(", ")})`,
      planModel,
      planInputs,
    );
  for (const t of draft.suggestedTests) book.recommended("suggested-tests", t, planModel, planInputs);

  const plan: MigrationPlan = MigrationPlanSchema.parse({
    dependency: pkg,
    fromVersion: dep.currentVersion,
    strategy: draft.strategy,
    target: draft.target,
    rules: [
      ...usageRules.rules.map((r) => ({
        id: r.id,
        path: relative(ctx.runDir, usageRulesPath),
        hasFix: false,
      })),
      ...(fixRules?.rules ?? []).map((r) => ({
        id: r.id,
        path: relative(ctx.runDir, fixRulesPath as string),
        hasFix: true,
      })),
    ],
    usage,
    concerns,
    rationale: draft.rationale,
    behavioralDifferences: draft.behavioralDifferences,
    confidence: draft.confidence,
    feasible: draft.feasible,
    claims: book.claims,
  });
  writeJson(ctx, "plan.json", plan);
  logEvent(
    ctx,
    `athena: ${plan.strategy} ${pkg} -> ${plan.target.name}@${plan.target.version}, ${usage.length} site(s), ${concerns.length} concern(s), feasible=${plan.feasible}`,
  );
  return { plan, usageRulesPath, fixRulesPath };
}
