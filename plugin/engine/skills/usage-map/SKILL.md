---
name: usage-map
description: Turns Opengrep matches for a dependency into a usage map (file, line, symbol, matching rule) and a migration plan with a target, ordered concerns, behavioural differences and a feasibility call. Use after usage rules have run, when deciding how to migrate or replace a dependency and in what order to change files.
metadata:
  owner: athena
  version: "0.1"
---

# Usage map and migration plan

## Usage map (deterministic)

The engine converts each Opengrep match into a usage site. Sites are OBSERVED claims citing file and line.
Group sites by file; the symbol is the called method (`format`, `add`, `diff`) or `import` for import sites.

## Migration plan (your task)

Given the findings for one dependency and its usage map, return a plan:

1. **Strategy.** `upgrade` (same package, newer major) or `replace` (different package). Prefer the option
   with the smallest behavioural surface. If the package is deprecated, prefer `replace` with the
   ecosystem's maintained successor.
2. **Target.** Exact package name and a concrete version that exists on the registry.
3. **Concerns.** An ordered list. Each concern becomes one commit:
   - `toolchain`: only when Scout set `lintConfigProposed`.
   - `dependency`: manifest and lockfile change.
   - `autofix`: sites covered by fix rules.
   - `model-edit`: one concern per file or tightly-coupled group of files, with explicit instructions
     naming each call site and the replacement API.
   - `tests`: characterization tests for touched call sites.
4. **Behavioural differences.** Every API difference that could change output for the calls in the usage
   map (formatting tokens, mutability, timezone handling, error behaviour). Be specific to the calls seen.
5. **Feasibility.** Set `feasible: false` with reasons when the dependency is entangled (for example: a
   used API has no equivalent, or behaviour cannot be preserved). `Not recommended` is a valid outcome.
6. **Confidence.** `low`, `medium` or `high`, justified in the rationale.

Everything in the plan is AI-RECOMMENDED. Only reference files and lines that appear in the usage map.
