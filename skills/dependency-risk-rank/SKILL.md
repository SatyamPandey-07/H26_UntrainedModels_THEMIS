---
name: dependency-risk-rank
description: Ranks a repository's direct npm or PyPI dependencies by maintenance risk using known vulnerabilities (npm audit, pip-audit, OSV-Scanner, Trivy), registry signals (deprecation or yanked releases, last publish date, maintainers, major versions behind) and transitive weight, without modifying the repository. Use when choosing which dependency Themis should migrate first, or when explaining why a dependency is risky.
compatibility: Needs network access to registry.npmjs.org or pypi.org, and api.osv.dev. Uses osv-scanner, trivy and pip-audit when on PATH; npm audit needs a lockfile.
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

## Python (PyPI) repositories

The same score applies; only the signal sources differ.

| Signal                       | Source                                                                                                           | Claim tag              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Vulnerabilities              | `pip-audit -r <pinned> --no-deps`, `osv-scanner` on requirements files, `trivy fs`                               | EXECUTED (command log) |
| Deprecation                  | the installed (else latest) release is yanked, or the project is classified `Development Status :: 7 - Inactive` | OBSERVED (URL)         |
| Latest version, last publish | `https://pypi.org/pypi/<name>/json`                                                                              | OBSERVED (URL)         |
| Maintainers                  | distinct `author` / `maintainer` names on PyPI (unknown when both are empty)                                     | OBSERVED (URL)         |
| Weekly downloads             | `https://pypistats.org/api/packages/<name>/recent`                                                               | OBSERVED (URL)         |
| Transitive weight            | unconditional `requires_dist` entries of the pinned release (one level)                                          | OBSERVED (URL)         |

Package names are compared in PEP 503 normalised form (`PyYAML` and `pyyaml` are the same package).
Entries that are not exactly pinned are ranked against the latest release and reported as a gap; URL, VCS and
editable requirements cannot be ranked and are listed as gaps.
