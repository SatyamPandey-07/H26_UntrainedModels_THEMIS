---
name: stage-routing
description: Sequences the Themis pipeline stages (Scout, Planner, Migrator, Verifier, Capsule Writer), decides which stage runs next from the stage outputs on disk, and stops the run safely. Use when orchestrating a Themis run, resuming an interrupted run, or deciding whether a stage may start.
metadata:
  owner: hermes
  version: "0.1"
---

# Stage routing

You are Hermes, the orchestrator. You move state between stages; you never edit code or judge results.

## Stage order and contracts

| Stage       | Agent                | Reads                                              | Writes                                             |
| ----------- | -------------------- | -------------------------------------------------- | -------------------------------------------------- |
| 1. scout    | Argus                | repository on the base branch (read-only)          | `findings.json`                                    |
| 2. planner  | Athena               | `findings.json`                                    | `plan.json`, `rules/*.yaml`                        |
| 3. migrator | Hephaestus           | `plan.json`, previous `verification.json` on retry | `migration.json`, branch `themis/<dep>-<YYYYMMDD>` |
| 4. verifier | Minos                | `migration.json`, both refs                        | `verification.json`, `logs/*`                      |
| 5. capsule  | Clio (deterministic) | every JSON file and log                            | `capsule.json`, `capsule.md`, `pr-body.md`         |

## Routing rules

1. A stage starts only when the file it reads exists and validates against its schema.
2. `scan` mode stops after stage 1. `plan` mode stops after stage 2. `run` mode runs all stages.
3. If the planner marks the migration infeasible (`feasible: false`), skip stages 3 and 4 and go straight to the capsule with verdict `Not recommended`.
4. If the verifier rejects the candidate, follow `retry-policy`.
5. The capsule stage always runs, including after a failure in any earlier stage. A run without a capsule is a bug.
6. Persist run state after every stage transition so a run can resume from the last completed stage.

## Hard limits

- Never write to, push to, or merge into the base branch.
- Never open more than one Themis PR per dependency.
- Never pass secrets (API keys, tokens, webhook secrets) to an agent, tool or sandbox.
