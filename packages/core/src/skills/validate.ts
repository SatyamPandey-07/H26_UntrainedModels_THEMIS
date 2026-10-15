#!/usr/bin/env node
import { AGENT_ROLES } from "../schema/claim.js";
import { findSkillsDir, loadAllSkills } from "./loader.js";

const dir = process.argv[2] ?? findSkillsDir();
const { skills, issues } = loadAllSkills(dir);

for (const skill of skills) {
  if (!skill.shared && !(skill.owner && skill.owner in AGENT_ROLES)) {
    issues.push({
      skill: skill.name,
      message: 'metadata.owner must name a Themis agent, or metadata.shared must be "true"',
    });
  }
}

for (const i of issues) console.error(`${i.skill}: ${i.message}`);
const owners = new Map<string, string[]>();
for (const s of skills) {
  const key = s.shared ? "shared" : (s.owner ?? "?");
  owners.set(key, [...(owners.get(key) ?? []), s.name]);
}
for (const [owner, names] of owners) console.log(`${owner.padEnd(11)} ${names.join(", ")}`);
console.log(`${skills.length} skills valid, ${issues.length} issue(s)`);
process.exit(issues.length > 0 ? 1 : 0);
