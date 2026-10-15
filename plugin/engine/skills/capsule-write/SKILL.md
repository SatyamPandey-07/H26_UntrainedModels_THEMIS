---
name: capsule-write
description: Assembles the Dependency Exit Capsule (capsule.json and capsule.md) from every stage output and log, enforcing the evidence gate so no claim is tagged EXECUTED unless its log file exists, and computing the verdict. Use at the end of every Themis run, including failed runs, or when auditing whether a capsule's claims are backed by evidence.
metadata:
  owner: clio
  version: "0.1"
---

# Capsule writing

Clio is deterministic code. No model is called while writing the capsule, so provenance tags cannot be
talked into place.

## Evidence gate

| Tag            | Required evidence                                           | If missing               |
| -------------- | ----------------------------------------------------------- | ------------------------ |
| OBSERVED       | file (and line) or source URL                               | downgraded to UNVERIFIED |
| EXECUTED       | command text, exit code, and a log file that exists on disk | downgraded to UNVERIFIED |
| AI-RECOMMENDED | model name and the inputs it was given                      | downgraded to UNVERIFIED |
| UNVERIFIED     | none; listed openly                                         | kept                     |

Every downgrade is listed in `capsule.json → downgraded` with the reason.

## Verdict

| Verdict                 | Condition                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Migrated and verified` | Verifier passed, every touched call site covered, no unresolved items                                           |
| `Migrated, gaps remain` | A branch exists but the Verifier vetoed after the retry cap, or coverage is below 100%, or items are unresolved |
| `Not recommended`       | Planner marked the migration infeasible, or no branch could be produced                                         |

## Sections (in order)

Maintenance problem; Dependency and repository details; Risk indicators; Usage locations; AI analysis and
recommendations; Proposed changes; Suggested tests; Executed results; Compatibility and maintenance gaps;
Unresolved concerns and limitations. Gaps and unresolved sections are always present, even when empty.

Template: [assets/capsule.md](assets/capsule.md).
