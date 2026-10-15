---
name: dependency-risk-rank
description: Ranks a repository's direct npm dependencies by maintenance risk using known vulnerabilities (npm audit, OSV-Scanner, Trivy), registry signals (deprecation, last publish date, maintainers, major versions behind) and transitive weight, without modifying the repository. Use when choosing which dependency Themis should migrate first, or when explaining why a dependency is risky.
compatibility: Needs network access to registry.npmjs.org and api.osv.dev. Uses osv-scanner and trivy when on PATH; npm audit needs a lockfile.
metadata:
  owner: argus
  version: "0.1"
---

# Dependency risk ranking

Scores are computed deterministically by the engine using the formula in
[references/scoring.md](references/scoring.md). The model never invents a score or a vulnerability.

## Inputs

| Signal                                                 | Tool                                                                                                  | Claim tag              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| Vulnerabilities                                        | `npm audit --json`, `osv-scanner scan source --format json`, `trivy fs --scanners vuln --format json` | EXECUTED (command log) |
| Deprecation, latest version, last publish, maintainers | `https://registry.npmjs.org/<name>`                                                                   | OBSERVED (URL)         |
| Weekly downloads                                       | `https://api.npmjs.org/downloads/point/last-week/<name>`                                              | OBSERVED (URL)         |
| Transitive weight                                      | `npm ls --all --json` on the installed tree, or the lockfile                                          | OBSERVED (file)        |

A scanner that is missing or fails is recorded as UNVERIFIED with the reason; ranking continues with the
signals that exist.

## Your task as the model

You receive the ranked list with every signal already attached. Write a one or two sentence rationale per
dependency that refers only to the signals given. Do not re-order the list, do not add vulnerabilities,
and do not recommend a replacement here; that is the Planner's job.

## Output

`findings.json` → `dependencies[]` sorted by `score` descending. Only direct dependencies are ranked;
transitive packages contribute to their parent's `transitiveCount`.
