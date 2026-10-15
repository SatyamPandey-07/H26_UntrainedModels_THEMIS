#!/usr/bin/env node
// Detects the toolchain of a Python repository that declares dependencies in requirements*.txt.
// Read-only; prints JSON to stdout, same shape as detect.mjs.
// Usage: node detect-python.mjs <repo-path>
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: detect-python.mjs <repo-path>");
  process.exit(2);
}

const has = (rel) => existsSync(join(repo, rel));
const read = (rel) => (has(rel) ? readFileSync(join(repo, rel), "utf8") : "");
const sources = {};

// Requirements files: root requirements*.txt (including dev-requirements.txt) and requirements/*.txt.
const reqFiles = [];
for (const name of readdirSync(repo).sort())
  if (/^[\w.-]*requirements[\w.-]*\.txt$/i.test(name) && statSync(join(repo, name)).isFile())
    reqFiles.push(name);
if (has("requirements") && statSync(join(repo, "requirements")).isDirectory())
  for (const name of readdirSync(join(repo, "requirements")).sort())
    if (/\.txt$/i.test(name)) reqFiles.push(`requirements/${name}`);
if (reqFiles.length === 0) {
  console.error("no requirements*.txt found (only pip requirements files are supported)");
  process.exit(1);
}

const names = new Set();
for (const f of reqFiles)
  for (const line of read(f).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m && !line.trim().startsWith("-")) names.add(m[1].toLowerCase().replace(/[-_.]+/g, "-"));
  }
const dep = (n) => names.has(n);

const pyproject = read("pyproject.toml");
const setupCfg = read("setup.cfg");
const toxIni = read("tox.ini");

sources.language = reqFiles[0];
sources.packageManager = reqFiles[0];

// Interpreter version.
let pythonVersion;
const versionOf = (text) => /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1];
if (has(".python-version")) {
  pythonVersion = versionOf(read(".python-version"));
  sources.pythonVersion = ".python-version";
} else if (has("runtime.txt")) {
  pythonVersion = versionOf(read("runtime.txt"));
  sources.pythonVersion = "runtime.txt";
} else {
  const rp = /requires-python\s*=\s*["']([^"']+)["']/.exec(pyproject)?.[1];
  const pr = /python_requires\s*=\s*([^\n]+)/.exec(setupCfg)?.[1];
  if (rp && versionOf(rp)) {
    pythonVersion = versionOf(rp);
    sources.pythonVersion = "pyproject.toml";
  } else if (pr && versionOf(pr)) {
    pythonVersion = versionOf(pr);
    sources.pythonVersion = "setup.cfg";
  }
}

// Test files, found with a shallow walk that skips environments and VCS data.
const SKIP = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".tox",
  ".themis",
  "site-packages",
]);
let testFiles = 0;
let budget = 3000;
const walk = (dir, depth) => {
  if (depth > 3 || budget <= 0) return;
  for (const entry of readdirSync(join(repo, dir))) {
    if (SKIP.has(entry) || budget-- <= 0) continue;
    const rel = dir ? `${dir}/${entry}` : entry;
    const st = statSync(join(repo, rel));
    if (st.isDirectory()) walk(rel, depth + 1);
    else if (/^test_.*\.py$|^.*_test\.py$/.test(entry)) testFiles += 1;
  }
};
walk("", 0);

// Test runner.
let testRunner;
let testCommand;
const pytestConfig =
  has("pytest.ini") ||
  has("conftest.py") ||
  has("tests/conftest.py") ||
  /\[tool\.pytest/.test(pyproject) ||
  /\[tool:pytest\]/.test(setupCfg) ||
  /\[pytest\]/.test(toxIni);
if (dep("pytest") || pytestConfig) {
  testRunner = "pytest";
  testCommand = "python -m pytest";
  sources.testCommand = has("pytest.ini") ? "pytest.ini" : dep("pytest") ? reqFiles[0] : "pyproject.toml";
} else if (testFiles > 0) {
  testRunner = "unittest";
  testCommand = "python -m unittest discover";
  sources.testCommand = "test files";
}

// Linters and formatter.
const linters = [];
if (has("ruff.toml") || has(".ruff.toml") || /\[tool\.ruff/.test(pyproject) || dep("ruff")) {
  linters.push("ruff");
  sources.linters = has("ruff.toml") ? "ruff.toml" : has(".ruff.toml") ? ".ruff.toml" : "pyproject.toml";
}
if (has(".flake8") || /\[flake8\]/.test(setupCfg) || /\[flake8\]/.test(toxIni) || dep("flake8")) {
  linters.push("flake8");
  sources.linters ??= has(".flake8") ? ".flake8" : "setup.cfg";
}
if (has(".pylintrc") || has("pylintrc") || /\[tool\.pylint/.test(pyproject) || dep("pylint")) {
  linters.push("pylint");
  sources.linters ??= has(".pylintrc") ? ".pylintrc" : "pyproject.toml";
}
const lintCommand = linters.includes("ruff")
  ? "python -m ruff check ."
  : linters.includes("flake8")
    ? "python -m flake8 ."
    : linters.includes("pylint")
      ? "python -m pylint --recursive=y ."
      : undefined;
const formatter =
  /\[tool\.black\]/.test(pyproject) || dep("black") ? "black" : linters.includes("ruff") ? "ruff" : undefined;

// Start command and port, only for frameworks whose entry point can be found.
let startCommand;
let port;
let entry;
const candidates = [
  "main.py",
  "app.py",
  "wsgi.py",
  "server.py",
  "api.py",
  "app/main.py",
  "app/app.py",
  "src/main.py",
  "src/app.py",
];
const moduleOf = (file) => file.replace(/\.py$/, "").replace(/\//g, ".");
const portIn = (src, fallback) => {
  const m =
    /\bport\s*=\s*(\d{2,5})/i.exec(src) ??
    /PORT["']?\s*(?:,|\|\||or)\s*["']?(\d{2,5})/.exec(src) ??
    undefined;
  return m ? Number(m[1]) : fallback;
};
if (has("manage.py") && dep("django")) {
  entry = "manage.py";
  port = 8000;
  startCommand = "python manage.py runserver 0.0.0.0:${PORT:-8000} --noreload";
} else if (dep("fastapi")) {
  for (const f of candidates) {
    const m = has(f) ? /^(\w+)\s*=\s*FastAPI\(/m.exec(read(f)) : undefined;
    if (m) {
      entry = f;
      port = portIn(read(f), 8000);
      startCommand = `python -m uvicorn ${moduleOf(f)}:${m[1]} --host 0.0.0.0 --port \${PORT:-${port}}`;
      break;
    }
  }
} else if (dep("flask")) {
  for (const f of candidates) {
    const m = has(f) ? /^(\w+)\s*=\s*Flask\(/m.exec(read(f)) : undefined;
    if (m) {
      entry = f;
      port = portIn(read(f), 5000);
      startCommand = `python -m flask --app ${moduleOf(f)}:${m[1]} run --host 0.0.0.0 --port \${PORT:-${port}}`;
      break;
    }
  }
}
if (entry) sources.port = entry;

const result = {
  language: "python",
  packageManager: "pip",
  pythonVersion,
  requirementsFiles: reqFiles,
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
