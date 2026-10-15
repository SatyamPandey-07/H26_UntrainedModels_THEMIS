---
description: Migrates one npm dependency on its own themis/* branch - maps every usage, plans the upgrade or replacement, edits the call sites, writes characterization tests that must pass on the old version, verifies the branch against the base branch, and writes a Dependency Exit Capsule tagging every claim by how it was established. Use when the user asks to upgrade, replace or migrate a dependency, or runs /themis:migrate.
argument-hint: "[package]"
---

# Themis migrate

You are the model for this run. The `themis` CLI (on PATH while the plugin is enabled) does every deterministic
step and records evidence; you write the plan, the code edits and the tests. Never push, never merge, never touch
the base branch, and never claim a result the CLI did not print.

Detailed guidance for each stage lives in `${CLAUDE_PLUGIN_ROOT}/engine/skills/<name>/SKILL.md`. Read
`migrate-dependency`, `characterization-tests` and `provenance-tagging` before editing code.

## 0. Headless shortcut

If `GROQ_API_KEY` is set in the environment and the user agrees, `themis run $ARGUMENTS` performs the whole
pipeline with Groq as the model. Otherwise continue below.

## 1. Choose the dependency

Use `$ARGUMENTS` if given; otherwise run `themis --json recommend` and confirm the choice with the user.

## 2. Map usage

```bash
themis step map <package>
```

The JSON output has `runDir` and `usage` (file, line, symbol). Keep `runDir` for every later step. If the map
looks incomplete (calls through a variable were missed), you may write extra Opengrep rules following
`engine/skills/opengrep-rule-author` and rerun with `--rules <file>`.

## 3. Plan

Read the files in the usage map. Write `<runDir>/draft.json`:

```json
{
  "strategy": "replace",
  "target": { "name": "dayjs", "version": "1.11.13" },
  "rationale": "Why this target, in two or three sentences.",
  "behavioralDifferences": ["Every API difference that can change output for the calls in the usage map."],
  "confidence": "medium",
  "feasible": true,
  "infeasibleReasons": [],
  "modelEditConcerns": [
    {
      "title": "migrate src/format.js",
      "files": ["src/format.js"],
      "instructions": "Name each call site and its replacement."
    }
  ],
  "suggestedTests": ["src/format.js:12 formatDate"]
}
```

`strategy` is `upgrade` or `replace`; `confidence` is `low`, `medium` or `high`. The target version must exist
on npm. Then run:

```bash
themis step plan <runDir> <runDir>/draft.json
```

If it is rejected, fix the draft and rerun. If the migration cannot preserve behaviour, set `"feasible": false`
with reasons, run `themis step plan`, then `themis capsule <runDir>`; the verdict is `Not recommended`, which is a
valid outcome.

## 4. Branch and edit

```bash
themis step branch <runDir>
```

This prints the branch and a `worktree` path and makes the deterministic commits (lint config if needed,
dependency swap, autofixes). For each `model-edit` concern in the plan, edit only the listed files inside the
worktree, then commit that concern:

```bash
themis step commit <runDir> <concernId> "<one line per file describing the change>"
```

Edits must preserve observable behaviour: same return values, formats and errors. Change only the listed call
sites and the import.

## 5. Characterization tests

Write tests in the worktree that call the project's own functions at each call site and assert today's exact
output, named `themis-<package>.characterization.test.<ext>`, each test name starting with `file:line`. Then:

```bash
themis step tests <runDir> <test files relative to the worktree>
```

Tests that fail on the base commit are discarded and listed as gaps. Do not edit a test to make it pass.

## 6. Verify and report

```bash
themis step verify <runDir>
```

Report the verdict, the branch name, call-site coverage and the capsule path exactly as printed, and summarise
`<runDir>/capsule.md`. If the verdict is not `Migrated and verified`, list the veto reasons and gaps from the
capsule. The branch is local; the user decides whether to push it.
