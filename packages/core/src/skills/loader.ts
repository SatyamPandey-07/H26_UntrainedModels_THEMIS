import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { AgentName } from "../schema/claim.js";

export interface Skill {
  name: string;
  description: string;
  compatibility?: string;
  metadata: Record<string, string>;
  /** Markdown body after the frontmatter. */
  body: string;
  dir: string;
  owner?: AgentName;
  shared: boolean;
}

export interface SkillIssue {
  skill: string;
  message: string;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Finds the repository-level `skills/` directory. `THEMIS_SKILLS_DIR` overrides the search. */
export function findSkillsDir(start: string = dirname(fileURLToPath(import.meta.url))): string {
  if (process.env.THEMIS_SKILLS_DIR) return resolve(process.env.THEMIS_SKILLS_DIR);
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, "skills");
    if (existsSync(join(candidate, "provenance-tagging", "SKILL.md"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("Could not locate the Themis skills/ directory; set THEMIS_SKILLS_DIR");
    dir = parent;
  }
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  return { frontmatter: match[1] ?? "", body: (match[2] ?? "").trim() };
}

/** Parses one skill folder and reports every violation of the Agent Skills specification. */
export function readSkill(dir: string): { skill?: Skill; issues: SkillIssue[] } {
  const folder = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  const issues: SkillIssue[] = [];
  const issue = (message: string) => issues.push({ skill: folder, message });
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    issue("SKILL.md is missing");
    return { issues };
  }
  const text = readFileSync(file, "utf8");
  const parts = splitFrontmatter(text);
  if (!parts) {
    issue("SKILL.md must start with YAML frontmatter between --- lines");
    return { issues };
  }
  let fm: Record<string, unknown>;
  try {
    fm = (parseYaml(parts.frontmatter) ?? {}) as Record<string, unknown>;
  } catch (err) {
    issue(`frontmatter is not valid YAML: ${(err as Error).message}`);
    return { issues };
  }

  const name = fm.name;
  if (typeof name !== "string" || name.length < 1 || name.length > 64) issue("name must be 1-64 characters");
  else {
    if (!NAME_RE.test(name)) issue("name may only contain a-z, 0-9 and single hyphens, not at the ends");
    if (name !== folder) issue(`name "${name}" must match the folder name "${folder}"`);
  }
  const description = fm.description;
  if (typeof description !== "string" || description.trim().length === 0) issue("description is required");
  else if (description.length > 1024) issue(`description is ${description.length} characters (max 1024)`);
  const compatibility = fm.compatibility;
  if (compatibility !== undefined && (typeof compatibility !== "string" || compatibility.length > 500))
    issue("compatibility must be a string of at most 500 characters");
  const metadata = fm.metadata ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) issue("metadata must be a key-value map");
  else
    for (const [k, v] of Object.entries(metadata))
      if (typeof v !== "string") issue(`metadata.${k} must be a string`);
  const known = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const key of Object.keys(fm)) if (!known.has(key)) issue(`unknown frontmatter field "${key}"`);

  const lines = text.split("\n").length;
  if (lines > 500) issue(`SKILL.md has ${lines} lines (keep under 500)`);

  for (const link of parts.body.matchAll(/\]\(((?:references|assets|scripts)\/[^)#\s]+)\)/g)) {
    if (link[1] && !existsSync(join(dir, link[1]))) issue(`linked file does not exist: ${link[1]}`);
  }

  if (issues.length > 0 || typeof name !== "string" || typeof description !== "string") return { issues };
  const meta = metadata as Record<string, string>;
  return {
    skill: {
      name,
      description,
      compatibility: typeof compatibility === "string" ? compatibility : undefined,
      metadata: meta,
      body: parts.body,
      dir,
      owner: meta.owner as AgentName | undefined,
      shared: meta.shared === "true",
    },
    issues,
  };
}

export function loadAllSkills(skillsDir: string = findSkillsDir()): {
  skills: Skill[];
  issues: SkillIssue[];
} {
  const skills: Skill[] = [];
  const issues: SkillIssue[] = [];
  for (const entry of readdirSync(skillsDir).sort()) {
    const dir = join(skillsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const result = readSkill(dir);
    issues.push(...result.issues);
    if (result.skill) skills.push(result.skill);
  }
  return { skills, issues };
}

/** Skills an agent loads: the ones it owns plus every shared skill. */
export function skillsFor(agent: AgentName, skillsDir?: string): Skill[] {
  const { skills, issues } = loadAllSkills(skillsDir);
  if (issues.length > 0) {
    throw new Error(`Invalid skills: ${issues.map((i) => `${i.skill}: ${i.message}`).join("; ")}`);
  }
  return skills.filter((s) => s.owner === agent || s.shared);
}

/** Renders skills into a system-prompt block. */
export function renderSkills(skills: Skill[]): string {
  return skills.map((s) => `<skill name="${s.name}">\n${s.description}\n\n${s.body}\n</skill>`).join("\n\n");
}

/** Skills whose full text is kept even in the digest: they carry safety rules the model must not lose. */
const DIGEST_KEEPS_FULL = new Set(["untrusted-input-guard"]);
/** Sections of a shared skill that instruct the model itself (the rest describes what the engine does). */
const MODEL_SECTION = /(for models|model output|rules for (the )?model)/i;

/**
 * A shorter rendering for requests that would otherwise exceed the model's token limit. Owned skills and the
 * untrusted-input guard stay whole; other shared skills keep their description and the sections addressed to
 * the model, and drop the engine-side tables and rules.
 */
export function renderSkillsDigest(skills: Skill[]): string {
  return skills
    .map((s) => {
      if (!s.shared || DIGEST_KEEPS_FULL.has(s.name)) return renderSkills([s]);
      const sections = s.body.split(/\n(?=#{2,} )/);
      const kept = sections.filter((sec, i) => i > 0 && MODEL_SECTION.test(sec.split("\n")[0] ?? ""));
      const body = kept.length > 0 ? kept.join("\n\n") : (sections[0] ?? "").slice(0, 700);
      return `<skill name="${s.name}">\n${s.description}\n\n${body}\n</skill>`;
    })
    .join("\n\n");
}

/** Reads a file bundled with a skill (references/, assets/, scripts/). */
export function readSkillFile(
  skillName: string,
  relPath: string,
  skillsDir: string = findSkillsDir(),
): string {
  return readFileSync(join(skillsDir, skillName, relPath), "utf8");
}

export function skillPath(skillName: string, relPath: string, skillsDir: string = findSkillsDir()): string {
  return join(skillsDir, skillName, relPath);
}
