---
name: toolchain-detect
description: Detects a JavaScript or TypeScript repository's language, package manager, Node version, test runner, formatter, linters, start command and port from its manifests and config files, without modifying anything. Use at the start of a Themis run, before risk ranking or linting, or whenever a stage needs to know how to install, test or lint a repository.
compatibility: Requires Node.js 20 or later. Reads the repository only; no network access needed.
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
