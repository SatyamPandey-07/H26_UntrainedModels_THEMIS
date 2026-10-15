---
name: opengrep-rule-author
description: Writes Opengrep (Semgrep-compatible) YAML rules that find every use of a given npm or PyPI dependency in a JavaScript, TypeScript or Python repository (imports, requires, calls and chained methods) and, where the rewrite is mechanical, adds a fix that performs the migration. Use when mapping where a dependency is used before planning a migration, or when a deterministic autofix can replace model edits.
compatibility: Requires opengrep on PATH and read access to the repository.
metadata:
  owner: athena
  version: "0.1"
---

# Opengrep rule authoring

Produce rules as YAML. Start from [assets/rule-template.yaml](assets/rule-template.yaml) and the
patterns in [references/rule-patterns.md](references/rule-patterns.md).

## Two kinds of rules

1. **Usage rules** (no `fix`). Find every import/require of the package and every call made through the
   imported binding. Each match becomes a usage site: file, line, symbol. Usage rules must have
   `severity: INFO` and `metadata.themis-kind: usage`.
2. **Fix rules** (with `fix`). Only for rewrites that are purely mechanical and behaviour-preserving, such
   as changing an import specifier or renaming a method with identical semantics. Mark them
   `metadata.themis-kind: fix`. If you are not certain the rewrite preserves behaviour, do not write a fix
   rule; leave that site to the Migrator's model edit.

## Rules for writing rules

- Use `languages: [javascript, typescript]` so both file types match. For Python repositories use
  `languages: [python]` and the patterns in [references/rule-patterns-python.md](references/rule-patterns-python.md).
- Bind the imported name with a metavariable (`$M`) and follow it with `pattern-inside` instead of
  guessing the local name.
- Every rule needs a unique `id` prefixed with `themis-<package>-`.
- Keep messages factual: what was matched, not advice.
- Never match files under `node_modules`, `dist`, `build`, `coverage` or `.themis` (for Python also `.venv`,
  `venv`, `__pycache__`, `.tox` and `site-packages`).

The engine runs every rule you write. A rule that fails to parse or matches nothing in a file that clearly
imports the package is reported back to you once for correction.
