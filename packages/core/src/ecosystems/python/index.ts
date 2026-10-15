import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shellQuote } from "../../evidence/command.js";
import type { DirectDependency } from "../../tools/lockfile.js";
import { mapLimit } from "../../util/misc.js";
import type { Ecosystem } from "../types.js";
import { applyPythonDependencyChange, proposePythonLintConfig } from "./edit.js";
import { importNames, normalizePythonName } from "./names.js";
import { pypiDoc, pypiProjectUrl, pypiRegistryInfo, requiresDist } from "./registry.js";
import { isDevRequirementsFile, lowerBound, pinnedVersion, readRequirements } from "./requirements.js";
import type { RequirementEntry } from "./requirements.js";
import { PYTHON_SCANNERS } from "./scanners.js";
import { parsePythonTestOutput, pythonSingleTestCommand, pythonTestCommand } from "./tests.js";
import { pythonImportRule, pythonRegexUsageMap } from "./usage.js";

const TEST_FILE = /(^|\/)(test_[^/]+|[^/]+_test)\.py$/;
const siteTag = (site: { file: string; line: number }) =>
  `L${site.line}_${site.file.replace(/[^A-Za-z0-9]+/g, "_")}`;

function modulesFor(file: string): string[] {
  const parts = file.replace(/\.py$/, "").split("/");
  const out = new Set<string>([parts.join(".")]);
  if (parts[parts.length - 1] === "__init__") out.add(parts.slice(0, -1).join("."));
  if (parts[0] === "src" && parts.length > 1) out.add(parts.slice(1).join("."));
  return [...out].filter(Boolean);
}

/** Python ecosystem: pip with requirements*.txt, pytest/unittest, ruff/flake8/pylint, PyPI. */
export const pythonEcosystem: Ecosystem = {
  id: "python",
  labels: {
    registry: "PyPI",
    packageNoun: "PyPI package",
    manifest: "requirements.txt",
    noTestReason: "no pytest or unittest configuration or test files found in the repository",
    noLinterGap:
      "No linter configuration found; Themis will propose a minimal ruff config in a separate commit.",
    noLinterReason: "no ruff, flake8 or pylint configuration in the repository",
    registryGapReason: "PyPI lookup failed or package is private",
  },
  detectScript: "scripts/detect-python.mjs",
  sourceFile: /\.py$/,
  testFile: TEST_FILE,
  ruleLanguages: ["python"],
  opengrepExcludes: [".venv", "venv", "__pycache__", ".tox", "site-packages", ".pytest_cache"],
  testShapesReference: "references/test-shapes-python.md",
  lintConcern: {
    files: ["ruff.toml", "requirements-dev.txt"],
    instructions: "Add a minimal ruff configuration (ruff.toml) and pin ruff in a dev requirements file.",
  },
  scanners: PYTHON_SCANNERS,

  normalizeName: normalizePythonName,

  async readDependencyGraph(repoPath) {
    const req = readRequirements(repoPath);
    const gaps: string[] = [];
    const byName = new Map<string, RequirementEntry[]>();
    for (const e of req.entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);

    const direct: DirectDependency[] = [];
    const unpinned: string[] = [];
    await mapLimit([...byName], 8, async ([name, entries]) => {
      const spec = entries.map((e) => e.specifier).find(Boolean) ?? "";
      let installed = entries.map((e) => pinnedVersion(e.specifier)).find(Boolean) ?? lowerBound(spec);
      if (!installed) {
        installed = (await pypiDoc(name))?.info.version;
        unpinned.push(name);
      }
      direct.push({
        name,
        declaredRange: spec || "*",
        dev: entries.every((e) => isDevRequirementsFile(e.file)),
        installedVersion: installed,
      });
    });
    direct.sort((a, b) => a.name.localeCompare(b.name));

    // One level of transitive weight from the pinned release's declared requirements on PyPI.
    const transitiveCount = new Map<string, number>();
    const parentsOf = new Map<string, Set<string>>();
    await mapLimit(direct, 8, async (d) => {
      const doc =
        (d.installedVersion ? await pypiDoc(d.name, d.installedVersion) : undefined) ??
        (await pypiDoc(d.name));
      const children = requiresDist(doc);
      transitiveCount.set(d.name, children.length);
      for (const c of children) parentsOf.set(c, (parentsOf.get(c) ?? new Set()).add(d.name));
    });

    if (unpinned.length > 0)
      gaps.push(
        `Not pinned (latest release assumed): ${unpinned.sort().join(", ")}. Pin exact versions for reliable results.`,
      );
    if (req.skipped.length > 0)
      gaps.push(
        `Skipped ${req.skipped.length} requirement line(s) that cannot be ranked: ${req.skipped
          .slice(0, 5)
          .map((s) => `${s.file}:${s.line} (${s.reason})`)
          .join("; ")}`,
      );
    if (req.files.length === 0) gaps.push("No requirements*.txt file was found.");
    return {
      graph: {
        direct,
        transitiveCount,
        parentsOf,
        source: req.files[0]?.path ?? "requirements.txt",
      },
      gaps,
    };
  },
  registryInfo: pypiRegistryInfo,
  registryUrl: pypiProjectUrl,

  importRule: pythonImportRule,
  regexUsageMap: pythonRegexUsageMap,
  promptContext(pkg, repoPath, files) {
    const imported = new Set<string>();
    for (const f of files.filter((x) => x.endsWith(".py")).slice(0, 400)) {
      try {
        for (const m of readFileSync(join(repoPath, f), "utf8").matchAll(
          /^[ \t]*(?:from|import)[ \t]+([A-Za-z_]\w*)/gm,
        ))
          imported.add(m[1] as string);
      } catch {
        // unreadable file: skip
      }
    }
    return {
      "candidate-import-names.txt": `${importNames(pkg).join("\n")}\n(The distribution name "${pkg}" may differ from the module you import; confirm against the list of imported modules.)`,
      "modules-imported-in-repo.txt": [...imported].sort().join("\n") || "(none found)",
    };
  },
  planManifestFiles: (toolchain) => toolchain.requirementsFiles ?? ["requirements.txt"],

  proposeLintConfig: proposePythonLintConfig,
  applyDependencyChange: applyPythonDependencyChange,

  testCommand: (toolchain, files) => pythonTestCommand(toolchain, files),
  singleTestCommand: pythonSingleTestCommand,
  parseTestOutput: parsePythonTestOutput,
  relatedTestFiles(worktree, changedSource, tracked) {
    const mods = changedSource.flatMap(modulesFor);
    const bases = new Set(changedSource.map((f) => (f.split("/").pop() ?? "").replace(/\.py$/, "")));
    const modRe = mods.length
      ? new RegExp(
          `^[ \\t]*(?:from|import)[ \\t]+(?:${mods.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:\\.|[ \\t,]|$)`,
          "m",
        )
      : undefined;
    const out: string[] = [];
    for (const f of tracked.filter((x) => TEST_FILE.test(x))) {
      const base = (f.split("/").pop() ?? "").replace(/\.py$/, "").replace(/^test_|_test$/g, "");
      let hit = bases.has(base);
      if (!hit && modRe) {
        try {
          hit = modRe.test(readFileSync(join(worktree, f), "utf8"));
        } catch {
          // deleted or unreadable: skip
        }
      }
      if (hit) out.push(f);
      if (out.length >= 200) break;
    }
    return out;
  },

  lintCommand(toolchain, files) {
    if (files.length === 0) return undefined;
    const q = files.map(shellQuote).join(" ");
    if (toolchain.linters.includes("ruff") || toolchain.lintConfigProposed)
      return { command: `python -m ruff check --output-format concise ${q}`, label: "Ruff" };
    if (toolchain.linters.includes("flake8")) return { command: `python -m flake8 ${q}`, label: "Flake8" };
    if (toolchain.linters.includes("pylint"))
      return { command: `python -m pylint --score=n ${q}`, label: "Pylint" };
    return undefined;
  },

  isCharacterizationTest: (path, slug) =>
    new RegExp(`(^|/)test_themis_${slug.replace(/-/g, "_")}_characterization\\.py$`).test(path),
  characterizationHint: (slug, toolchain) =>
    [
      `Name each file test_themis_${slug.replace(/-/g, "_")}_characterization.py and place it in the project's tests`,
      `directory (next to existing tests) so ${toolchain.testRunner ?? "the project's"} runner picks it up.`,
      "Name every test function test_<tag>_<description> where <tag> is the value from call-site-tags.json for the",
      "call site it pins (for example test_L12_src_dates_py_parses_iso). Import project modules, never the",
      "dependency directly. Use fixed inputs only.",
    ].join(" "),
  characterizationData: (usage) => ({
    "call-site-tags.json": JSON.stringify(
      usage
        .filter((s) => s.symbol !== "import")
        .map((s) => ({ site: `${s.file}:${s.line}`, tag: siteTag(s), symbol: s.symbol })),
      null,
      2,
    ),
  }),
  siteTag,
};
