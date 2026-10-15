---
name: pr-report
description: Renders the draft pull request body and the GitHub Check Run summary and line annotations from a finished capsule, following the Themis PR layout - verdict line, summary table, provenance legend, collapsible evidence sections, and an always-present gaps section. Use when opening or updating a Themis pull request or check run.
metadata:
  owner: clio
  version: "0.1"
---

# PR report

Deterministic, like `capsule-write`. The PR body is rendered only from `capsule.json`.

## Layout

Title: the dependency commit subject, for example `build(deps): upgrade svix from 2.0.0 to 2.8.0`.

1. Heading with the verdict, and a one-paragraph provenance legend.
2. Key facts table: change, verdict, stated confidence, call sites covered, files changed, run link.
3. **Why `<dependency>`**: the risk score broken into its signals with points, the blast radius (files and call
   sites), and whether Themis selected it (most risk per affected file) or it was requested.
4. **What changed**: one row per commit with the agent that made it.
5. **Verification**: default branch versus this branch for install, tests, lint and security, then new
   failures, coverage and any veto.
6. **Gaps and unresolved concerns**, always present (write "None recorded." when empty).
7. Collapsible `<details>`: usage map, plan rationale and behavioural differences, Opengrep rules, lint and
   security delta, black-box probes, and the full Dependency Exit Capsule (trimmed first if the body would
   exceed GitHub's 65,536-character limit; the full capsule is always committed under `.themis/`).

Template: [assets/pr-body.md](assets/pr-body.md).

## Check Run

- Conclusion: `success` for `Migrated and verified`, `neutral` for `Migrated, gaps remain`, `action_required`
  for `Not recommended`.
- One annotation (level `notice`) per usage site on the branch, at most 50, message naming the symbol and
  whether a characterization test covers it.
- Labels on the PR: `themis`, `ai-generated`. The PR is always a draft.
