#!/usr/bin/env node
// Merges the run directories produced by Minos's parallel sandbox jobs into one run directory, so the verdict job
// sees both sides' reports, logs and evidence index. Usage: merge-sides.mjs <runDir> <side.tgz>...
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [runDir, ...archives] = process.argv.slice(2);
if (!runDir || archives.length === 0) {
  console.error("usage: merge-sides.mjs <runDir> <side.tgz>...");
  process.exit(2);
}
const runId = basename(runDir);
const evidence = new Set(existsSync(join(runDir, "evidence.jsonl")) ? readFileSync(join(runDir, "evidence.jsonl"), "utf8").split("\n").filter(Boolean) : []);
const before = evidence.size;

for (const archive of archives) {
  if (!existsSync(archive)) {
    console.warn(`missing ${archive}; that sandbox job did not finish`);
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), "themis-side-"));
  execFileSync("tar", ["-xzf", archive, "-C", dir]);
  const side = join(dir, ".themis", "runs", runId);
  if (!existsSync(side)) continue;
  for (const f of readdirSync(side)) {
    if (/^verify-(baseline|candidate)-a\d+\.json$/.test(f) || f === "probes.json") cpSync(join(side, f), join(runDir, f));
  }
  if (existsSync(join(side, "logs"))) cpSync(join(side, "logs"), join(runDir, "logs"), { recursive: true, force: false, errorOnExist: false });
  if (existsSync(join(side, "evidence.jsonl")))
    for (const line of readFileSync(join(side, "evidence.jsonl"), "utf8").split("\n")) if (line) evidence.add(line);
}
writeFileSync(join(runDir, "evidence.jsonl"), [...evidence].join("\n") + "\n");
appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/dev/null", `Merged ${archives.length} sandbox report(s); ${evidence.size - before} new evidence record(s).\n`);
console.log(`merged ${archives.length} side(s) into ${runDir}`);
