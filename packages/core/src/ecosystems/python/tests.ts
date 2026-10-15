import { shellQuote } from "../../evidence/command.js";
import type { ParsedTests } from "../../sandbox/tests.js";
import type { Toolchain } from "../../schema/stages.js";

const JUNIT_MARKER = "THEMIS_TEST_JUNIT";
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** Module path for unittest from a test file path: tests/test_a.py -> tests.test_a. */
function moduleOf(file: string): string {
  return file.replace(/\.py$/, "").replace(/\//g, ".");
}

const PYTEST = "python -m pytest -p no:cacheprovider -q --junitxml=/tmp/themis-tests.xml";

/** One test command for both sandboxes. pytest writes JUnit XML that parseTestOutput reads after a marker. */
export function pythonTestCommand(toolchain: Toolchain, files: string[]): string {
  const quoted = files.map(shellQuote).join(" ");
  if (toolchain.testRunner === "unittest") {
    return files.length
      ? `python -m unittest -v ${files.map((f) => shellQuote(moduleOf(f))).join(" ")} 2>&1`
      : "python -m unittest discover -v 2>&1";
  }
  // pytest exit code 5 means "no tests collected"; treat it as success like jest --passWithNoTests.
  const report = `; code=$?; [ "$code" -eq 5 ] && code=0; echo ${JUNIT_MARKER}; cat /tmp/themis-tests.xml 2>/dev/null; exit $code`;
  return `${PYTEST} ${quoted}${report}`.replace(/\s+;/, ";");
}

/** Command for a single characterization test file (keep-or-discard check on the baseline). */
export function pythonSingleTestCommand(toolchain: Toolchain, file: string): string {
  if (toolchain.testRunner === "unittest") return `python -m unittest -v ${shellQuote(moduleOf(file))} 2>&1`;
  return `python -m pytest -p no:cacheprovider -q ${shellQuote(file)}`;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1] as string] = decode(m[2] as string);
  return out;
}

/** Parses pytest JUnit XML (after the marker) or `unittest -v` lines; falls back to the exit code. */
export function parsePythonTestOutput(stdout: string, exitCode: number): ParsedTests {
  const idx = stdout.lastIndexOf(JUNIT_MARKER);
  const xml = idx >= 0 ? stdout.slice(idx + JUNIT_MARKER.length) : "";
  const passing: string[] = [];
  const failing: string[] = [];
  let seen = 0;
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = attrs(m[1] as string);
    const body = m[3] ?? "";
    const name = a.classname ? `${a.classname}::${a.name ?? "unnamed"}` : (a.name ?? "unnamed test");
    seen += 1;
    if (/<(failure|error)\b/.test(body)) failing.push(name);
    else if (!/<skipped\b/.test(body)) passing.push(name);
  }
  if (seen > 0)
    return {
      passed: passing.length,
      failed: failing.length,
      total: seen,
      failingTests: failing,
      passingTests: passing,
    };
  for (const m of stdout.matchAll(/^(.+?)\s+\.\.\.\s+(ok|FAIL|ERROR)\s*$/gm)) {
    const name = (m[1] as string).trim();
    if (m[2] === "ok") passing.push(name);
    else failing.push(name);
  }
  if (passing.length + failing.length > 0)
    return {
      passed: passing.length,
      failed: failing.length,
      total: passing.length + failing.length,
      failingTests: failing,
      passingTests: passing,
    };
  return {
    passed: exitCode === 0 ? 1 : 0,
    failed: exitCode === 0 ? 0 : 1,
    total: 1,
    failingTests: exitCode === 0 ? [] : ["test command failed (no per-test report)"],
    passingTests: [],
  };
}
