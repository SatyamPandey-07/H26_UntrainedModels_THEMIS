---
name: retry-policy
description: Decides whether a failed migration attempt is retried, what failure evidence is passed back to the Migrator, and when an item is recorded as unresolved. Use when the Verifier rejects a candidate branch or a stage fails mid-run.
metadata:
  owner: hermes
  version: "0.1"
---

# Retry policy

The retry cap is `THEMIS_RETRY_CAP` (default 2). Attempt 0 is the first migration; retries are attempts 1..cap.

## When the Verifier rejects the candidate

1. If `attempt < cap`: send the Migrator the veto reasons, the names of newly failing tests, and the tail
   (last 120 lines) of each failing log. Do not send whole logs and do not send passing output.
2. If `attempt == cap`: stop retrying. Record every remaining veto reason as an UNVERIFIED claim in the
   `unresolved` section and continue to the capsule stage. The verdict becomes `Migrated, gaps remain`
   or `Not recommended` (Clio decides from the evidence).

## Never retry

- Planner infeasibility (`feasible: false`). That is a valid `Not recommended` outcome.
- Baseline failures. A red base branch is recorded, never "fixed" by Themis.
- Infrastructure errors that would fail identically again (missing tool, Docker unavailable). Record them as
  UNVERIFIED with the reason.

See [references/failure-classes.md](references/failure-classes.md) for how to classify a failure.
