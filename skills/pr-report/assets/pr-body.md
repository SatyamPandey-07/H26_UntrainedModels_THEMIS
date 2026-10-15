## Themis: {{verdict}}

> Draft opened by Themis. Every claim is tagged by how it was established: `OBSERVED` (read from the
> repository or a registry), `EXECUTED` (ran in a sandbox, log attached), `AI-RECOMMENDED` (model reasoning)
> or `UNVERIFIED` (not backed by a check). Themis never merges; review before you do.

|                    |                                        |
| ------------------ | -------------------------------------- |
| Change             | {{change}}                             |
| Verdict            | {{verdict}}                            |
| Confidence         | {{confidence}} (stated by the planner) |
| Call sites covered | {{covered}} of {{callSites}}           |
| Files changed      | {{filesChanged}}                       |
| Run                | {{run}}                                |

### Why `{{dependency}}`

{{why}}

### What changed

{{commits}}

### Verification: default branch versus this branch

{{results}}

### Gaps and unresolved concerns

{{gaps}}

<details><summary>Usage map ({{usageCount}} sites)</summary>

{{usageMap}}

</details>

<details><summary>Plan rationale and behavioural differences</summary>

{{rationale}}

</details>

<details><summary>Opengrep rules used</summary>

{{rules}}

</details>

<details><summary>Lint and security delta</summary>

{{lintSecurity}}

</details>

<details><summary>Black-box probes</summary>

{{probes}}

</details>

<details><summary>Dependency Exit Capsule</summary>

{{capsule}}

</details>

<sub>Agents: Argus (scout) · Athena (planner) · Hephaestus (migrator) · Minos (verifier) · Clio (capsule writer). Capsule committed at `{{capsulePath}}`.</sub>
