#!/usr/bin/env node
// Detects the toolchain of a JavaScript/TypeScript repository. Read-only; prints JSON to stdout.
// Usage: node detect.mjs <repo-path>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: detect.mjs <repo-path>");
  process.exit(2);
}

const has = (rel) => existsSync(join(repo, rel));
const read = (rel) => (has(rel) ? readFileSync(join(repo, rel), "utf8") : undefined);

let pkg = {};
try {
  pkg = JSON.parse(read("package.json") ?? "{}");
} catch {
  console.error("package.json is not valid JSON");
  process.exit(1);
}
if (!has("package.json")) {
  console.error("no package.json found");
  process.exit(1);
}

const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const scripts = pkg.scripts ?? {};
const sources = {};

const packageManager = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
sources.packageManager = has("pnpm-lock.yaml")
  ? "pnpm-lock.yaml"
  : has("yarn.lock")
    ? "yarn.lock"
    : has("package-lock.json")
      ? "package-lock.json"
      : "package.json";

const language = has("tsconfig.json") || "typescript" in deps ? "typescript" : "javascript";
sources.language = has("tsconfig.json") ? "tsconfig.json" : "package.json";

let nodeVersion;
for (const f of [".nvmrc", ".node-version"]) {
  if (has(f)) {
    nodeVersion = read(f).trim();
    sources.nodeVersion = f;
    break;
  }
}
if (!nodeVersion && pkg.engines?.node) {
  nodeVersion = pkg.engines.node;
  sources.nodeVersion = "package.json";
}

const testScript = scripts.test && !/no test specified/.test(scripts.test) ? scripts.test : undefined;
const runners = ["vitest", "jest", "mocha", "ava", "tap"];
let testRunner = runners.find((r) => (testScript ?? "").includes(r)) ?? runners.find((r) => r in deps);
if (!testRunner && testScript && /node\s+(--test|.*\btest\b)/.test(testScript)) testRunner = "node:test";
const run = packageManager === "npm" ? "npm" : packageManager;
const testCommand = testScript ? `${run} test` : undefined;
if (testScript) sources.testCommand = "package.json";

const prettierFiles = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.cjs",
  "prettier.config.js",
  "prettier.config.mjs",
];
const formatter =
  prettierFiles.some(has) || "prettier" in deps || pkg.prettier
    ? "prettier"
    : has("biome.json") || "@biomejs/biome" in deps
      ? "biome"
      : undefined;

const eslintFiles = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.yml",
];
const linters = [];
const eslintConfig = eslintFiles.find(has);
if (eslintConfig || pkg.eslintConfig) {
  linters.push("eslint");
  sources.linters = eslintConfig ?? "package.json";
}
if (has("biome.json")) linters.push("biome");
const lintCommand = scripts.lint
  ? `${run} run lint`
  : linters.includes("eslint")
    ? "npx eslint ."
    : undefined;

const startCommand = scripts.start ? `${run} start` : undefined;
let port;
const entry = [
  pkg.main,
  "server.js",
  "index.js",
  "app.js",
  "src/server.js",
  "src/index.js",
  "src/app.js",
].find((f) => f && has(f));
if (entry) {
  const src = read(entry);
  const m =
    /PORT\s*(?:\|\||\?\?)\s*(\d{2,5})/.exec(src) ??
    /\.listen\(\s*(\d{2,5})/.exec(src) ??
    /port\s*=\s*(\d{2,5})/i.exec(src);
  if (m) {
    port = Number(m[1]);
    sources.port = entry;
  }
}

const result = {
  language,
  packageManager,
  nodeVersion,
  testRunner,
  testCommand,
  formatter,
  linters,
  lintCommand,
  lintConfigProposed: linters.length === 0,
  startCommand,
  port,
  entry,
  sources,
};
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
