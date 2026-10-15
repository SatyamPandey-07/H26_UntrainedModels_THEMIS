---
name: migrate-dependency
description: Applies a Themis migration plan on a dedicated branch in a git worktree, one commit per concern - dependency swap, deterministic Opengrep autofixes first, then minimal model edits for what rules cannot express. Use when executing plan.json for a dependency upgrade or replacement, or when fixing a candidate after the Verifier returned failure logs.
compatibility: Requires git, the repository's package manager, and opengrep on PATH.
metadata:
  owner: hephaestus
  version: "0.1"
---

# Migrate a dependency

## Branch rules

- Work only in the worktree on branch `themis/<dep>-<YYYYMMDD>`. Never touch the base branch.
- One commit per concern, in plan order. Commit messages: `themis(<kind>): <concern title>`.

## Order of changes

1. `toolchain` concern, if present: add a minimal lint config only.
2. `dependency` concern: the engine updates `package.json` and the lockfile with the package manager.
3. `autofix` concern: the engine runs fix rules with `opengrep --autofix`.
4. `model-edit` concerns: you edit files.
5. `tests` concern: see `characterization-tests`.

## How to edit (model-edit concerns)

- Read the file with `read_file` before changing it. Use `replace_in_file` with an exact, unique
  `search` string; fall back to `write_file` only for files under 200 lines.
- Change only the call sites listed in the concern. Do not reformat, rename, or refactor anything else.
- Preserve observable behaviour: same return values, same string formats, same errors. When the new API
  differs, add the smallest adapter at the call site (see
  [references/moment-to-dayjs.md](references/moment-to-dayjs.md) for a worked example).
- Do not add dependencies other than the plan's target.
- When you finish a concern, reply with a short summary of what you changed per file. Do not claim tests
  pass; the Verifier decides that.

## On retry

You receive the Verifier's veto reasons and failing log tails. Fix the cause in a new commit on the same
branch. Never edit or delete a characterization test to make it pass.
