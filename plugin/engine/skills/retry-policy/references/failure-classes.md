# Failure classes

| Class                | Signal                                                  | Retry?         | Record as                                                   |
| -------------------- | ------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| Regression           | A test passes on baseline and fails on candidate        | Yes, up to cap | `executed-results` (EXECUTED) + `unresolved` if cap reached |
| Build break          | Candidate install or type check fails, baseline passes  | Yes, up to cap | `executed-results` (EXECUTED)                               |
| Lint regression      | Candidate lint violations > baseline violations         | Yes, up to cap | `executed-results` (EXECUTED)                               |
| New vulnerability    | Security rescan finds an ID absent on baseline          | Yes, up to cap | `executed-results` (EXECUTED)                               |
| Probe mismatch       | Same request, different status or body                  | Yes, up to cap | `executed-results` (EXECUTED)                               |
| Pre-existing failure | Fails on baseline too                                   | No             | `gaps` (UNVERIFIED)                                         |
| Infrastructure       | Tool missing, Docker unreachable, timeout on both sides | No             | `unresolved` (UNVERIFIED)                                   |
| Infeasible           | Planner sets `feasible: false`                          | No             | `ai-analysis` (AI-RECOMMENDED), verdict `Not recommended`   |
