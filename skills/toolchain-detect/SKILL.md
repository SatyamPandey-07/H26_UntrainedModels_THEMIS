---
name: toolchain-detect
description: Detects a JavaScript, TypeScript or Python repository's language, package manager, runtime version, test runner, formatter, linters, start command and port from its manifests and config files, without modifying anything. Use at the start of a Themis run, before risk ranking or linting, or whenever a stage needs to know how to install, test or lint a repository.
compatibility: Requires Node.js 20 or later to run the detectors (also for Python repositories). Reads the repository only; no network access needed.
metadata:
  owner: argus
  version: "0.1"
---

# Toolchain detection

Run the bundled detector against the repository root. It prints one JSON object to stdout:

```bash
node scripts/detect.mjs /path/to/repo
```

| Field                       | Source                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `language`                  | `typescript` if `tsconfig.json` or a `typescript` dependency exists, else `javascript` |
| `packageManager`            | lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise npm                   |
| `nodeVersion`               | `.nvmrc`, `.node-version`, or `engines.node`                                           |
| `testRunner`, `testCommand` | `scripts.test` and the runner it invokes (jest, vitest, mocha, node:test)              |
| `formatter`                 | prettier or biome config or dependency                                                 |
| `linters`, `lintCommand`    | eslint or biome config, `scripts.lint`                                                 |
| `startCommand`, `port`      | `scripts.start` and the port literal or `PORT` default in the entry file               |

## Rules

- Detection is read-only. Never install, never run project scripts.
- A missing test command is a finding, not an error. Report it so the capsule can list it as a gap.
- If no linter config exists, set `lintConfigProposed: true`; the Migrator adds a minimal config in its own
  `toolchain` commit (requirement F1). Never add it to the base branch.
- Every detected value is an OBSERVED claim and must cite the file it came from.

## Python repositories

A repository without `package.json` that declares dependencies in `requirements*.txt` is a Python (pip)
repository. Run the Python detector instead; it prints the same JSON shape:

```bash
node scripts/detect-python.mjs /path/to/repo
```

| Field                        | Source                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `language`, `packageManager` | always `python` and `pip`                                                                          |
| `requirementsFiles`          | root `requirements*.txt` and `requirements/*.txt`                                                  |
| `pythonVersion`              | `.python-version`, `runtime.txt`, `requires-python` or `python_requires`                           |
| `testRunner`, `testCommand`  | pytest (config, `conftest.py` or requirement) → `python -m pytest`; else unittest when tests exist |
| `linters`, `lintCommand`     | ruff, flake8 or pylint config or requirement                                                       |
| `formatter`                  | black or ruff                                                                                      |
| `startCommand`, `port`       | Django `manage.py`, or the `FastAPI(` / `Flask(` application object in a conventional file         |

Only pip requirements files are read. `pyproject.toml`-only, Poetry, uv and Pipenv projects are reported as
unsupported rather than guessed at.
