import { shellQuote } from "../../evidence/command.js";
import { parseTestOutput, singleTestCommand, testCommand } from "../../sandbox/tests.js";
import { readDependencyGraph } from "../../tools/lockfile.js";
import { regexUsageMap } from "../../tools/opengrep.js";
import { npmRegistryInfo } from "../../tools/registry.js";
import { DEFAULT_SCANNERS } from "../../tools/scanners.js";
import type { Ecosystem } from "../types.js";
import { importRule } from "./rules.js";

/**
 * Node/TypeScript ecosystem. Every member is the original function, called with the original arguments, so
 * routing the pipeline through this adapter does not change behaviour for npm, pnpm or yarn repositories.
 */
export const nodeEcosystem: Ecosystem = {
  id: "node",
  labels: {
    registry: "npm",
    packageNoun: "npm package",
    manifest: "package.json",
    noTestReason: "package.json has no usable test script",
    noLinterGap:
      "No linter configuration found; Themis will propose a minimal ESLint config in a separate commit.",
    noLinterReason: "no eslint or biome config in the repository",
    registryGapReason: "npm registry lookup failed or package is private",
  },
  detectScript: "scripts/detect.mjs",
  sourceFile: /\.(c|m)?(j|t)sx?$/,
  testFile: /\.(test|spec)\.[cm]?[jt]sx?$/,
  ruleLanguages: ["javascript", "typescript"],
  opengrepExcludes: [],
  testShapesReference: "references/test-shapes.md",
  lintConcern: {
    files: ["eslint.config.mjs"],
    instructions: "Add a minimal ESLint flat config using @eslint/js recommended rules.",
  },
  scanners: DEFAULT_SCANNERS,

  normalizeName: (name) => name,
  readDependencyGraph: async (repoPath) => ({ graph: readDependencyGraph(repoPath), gaps: [] }),
  registryInfo: (name, installedVersion) => npmRegistryInfo(name, installedVersion),
  registryUrl: (name) => `https://registry.npmjs.org/${name}`,

  importRule,
  regexUsageMap,
  promptContext: () => ({}),
  planManifestFiles: () => ["package.json", "package-lock.json"],

  testCommand,
  singleTestCommand,
  parseTestOutput,

  lintCommand(toolchain, files) {
    if (!(toolchain.linters.includes("eslint") || toolchain.lintConfigProposed)) return undefined;
    return {
      command: `npx --no-install eslint --no-warn-ignored ${files.map(shellQuote).join(" ")}`,
      label: "ESLint",
    };
  },

  isCharacterizationTest: (path, slug) =>
    new RegExp(`(^|/)themis-${slug}\\.characterization\\.test\\.[cm]?[jt]sx?$`).test(path),
  characterizationHint: (slug, toolchain) =>
    [
      `Name each file themis-${slug}.characterization.test.<ext> and place it next to existing tests so the`,
      `${toolchain.testRunner ?? "project"} runner picks it up. Each test name must start with the call site as`,
      "file:line. Import project modules, never the dependency directly. Use fixed inputs only.",
    ].join(" "),
  siteTag: (site) => `${site.file}:${site.line}`,
};
