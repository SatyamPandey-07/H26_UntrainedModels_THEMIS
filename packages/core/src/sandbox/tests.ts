import type { Toolchain } from "../schema/stages.js";
import { shellQuote } from "../evidence/command.js";
import { safeJson } from "../util/misc.js";

export interface ParsedTests {
  passed: number;
  failed: number;
  total: number;
  /** Full names of failing tests. */
  failingTests: string[];
  /** Full names of passing tests (used for call-site coverage). */
  passingTests: string[];
}

const JSON_MARKER = "THEMIS_TEST_JSON";

/**
 * Builds one test command for both sandboxes. With `files`, only those tests (and, for Jest, tests related to
 * them) run; without, the project's full test script runs. Jest and Vitest write a JSON report we can parse.
 */
export function testCommand(
  toolchain: Toolchain,
  files: string[],
  opts: { related?: string[] } = {},
): string {
  const runner = toolchain.testRunner;
  const quoted = files.map(shellQuote).join(" ");
  const related = (opts.related ?? []).map(shellQuote).join(" ");
  const report = `; code=$?; echo ${JSON_MARKER}; cat /tmp/themis-tests.json 2>/dev/null; exit $code`;
  if (runner === "jest") {
    const select = files.length || related ? `--findRelatedTests ${related} ${quoted}` : "";
    return `npx --no-install jest --ci --passWithNoTests --cacheDirectory /tmp/jest --json --outputFile /tmp/themis-tests.json ${select}${report}`;
  }
  if (runner === "vitest") {
    return `npx --no-install vitest run --passWithNoTests --reporter=json --outputFile=/tmp/themis-tests.json ${quoted}${report}`;
  }
  if (runner === "node:test")
    return files.length ? `node --test ${quoted}` : (toolchain.testCommand ?? "npm test");
  if (runner === "mocha")
    return files.length ? `npx --no-install mocha ${quoted}` : (toolchain.testCommand ?? "npm test");
  return toolchain.testCommand ?? "npm test";
}

/** Command for a single characterization test file (keep-or-discard check on the baseline). */
export function singleTestCommand(toolchain: Toolchain, file: string): string {
  const f = shellQuote(file);
  switch (toolchain.testRunner) {
    case "jest":
      return `npx --no-install jest --ci --cacheDirectory /tmp/jest --runTestsByPath ${f}`;
    case "vitest":
      return `npx --no-install vitest run ${f}`;
    case "mocha":
      return `npx --no-install mocha ${f}`;
    default:
      return `node --test ${f}`;
  }
}

interface JestLikeReport {
  numPassedTests?: number;
  numFailedTests?: number;
  numTotalTests?: number;
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string }>;
  }>;
}

/** Parses Jest/Vitest JSON (after the marker), TAP output, or falls back to the exit code. */
export function parseTestOutput(stdout: string, exitCode: number): ParsedTests {
  const idx = stdout.lastIndexOf(JSON_MARKER);
  const report =
    idx >= 0 ? safeJson<JestLikeReport>(stdout.slice(idx + JSON_MARKER.length).trim()) : undefined;
  if (report?.testResults) {
    const failing: string[] = [];
    const passing: string[] = [];
    for (const file of report.testResults)
      for (const a of file.assertionResults ?? []) {
        const name = a.fullName ?? a.title ?? "unnamed test";
        if (a.status === "passed") passing.push(name);
        else if (a.status === "failed") failing.push(name);
      }
    return {
      passed: report.numPassedTests ?? passing.length,
      failed: report.numFailedTests ?? failing.length,
      total: report.numTotalTests ?? passing.length + failing.length,
      failingTests: failing,
      passingTests: passing,
    };
  }
  const tapOk = [...stdout.matchAll(/^\s*ok \d+ - (.+)$/gm)].map((m) => m[1] as string);
  const tapFail = [...stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1] as string);
  if (tapOk.length + tapFail.length > 0)
    return {
      passed: tapOk.length,
      failed: tapFail.length,
      total: tapOk.length + tapFail.length,
      failingTests: tapFail,
      passingTests: tapOk,
    };
  return {
    passed: exitCode === 0 ? 1 : 0,
    failed: exitCode === 0 ? 0 : 1,
    total: 1,
    failingTests: exitCode === 0 ? [] : ["test command failed (no per-test report)"],
    passingTests: [],
  };
}
