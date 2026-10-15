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

1. Verdict line with the stated confidence.
2. Summary table: dependency, from, to, files changed, call sites covered, risk score.
3. Provenance legend with the four tags.
4. Collapsible `<details>` sections: usage map, Opengrep rules used, diff rationale, baseline versus
   branch results, lint and security delta, black-box probes.
5. Gaps and unresolved concerns, always present (write "None recorded." when empty).
6. Link to the full capsule committed under `.themis/`.

Template: [assets/pr-body.md](assets/pr-body.md).

## Check Run

- Conclusion: `success` for `Migrated and verified`, `neutral` for `Migrated, gaps remain`, `action_required`
  for `Not recommended`.
- One annotation (level `notice`) per usage site on the branch, at most 50, message naming the symbol and
  whether a characterization test covers it.
- Labels on the PR: `themis`, `ai-generated`. The PR is always a draft.
