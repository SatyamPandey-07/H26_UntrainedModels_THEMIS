---
name: sandbox-verify
description: Builds the base branch and the Themis candidate branch in identical Docker sandboxes (network cut after install, resource limits, read-only source), runs the same tests, lint and security rescans in both, and judges only the difference. Use when verifying a migration, deciding the Verifier veto, or explaining why a candidate was rejected.
compatibility: Requires Docker with a running daemon. Dependency install needs registry network access; everything after install runs with no network.
metadata:
  owner: minos
  version: "0.1"
---

# Sandbox verification

## Identical setup

Baseline (base branch) and candidate (Themis branch) use the same image, the same install command, the
same test, lint and scan commands, and the same flags. See
[references/sandbox-flags.md](references/sandbox-flags.md).

## Procedure (engine-run, every command logged)

1. Build image per ref: copy source, install dependencies with network.
2. Run with `--network none`: tests, lint, Opengrep usage rules, Trivy (offline DB).
3. Start the app and send black-box probes (see `blackbox-probe-diff`).
4. Compute the delta:
   - new failures: tests failing on candidate that pass on baseline
   - lint delta: candidate violations minus baseline violations
   - security delta: vulnerability IDs present only on candidate
   - probe mismatches
   - call-site coverage: touched sites named by a passing characterization test, as n of m

## Veto (you hold it)

Reject the candidate when any of these is true: a new test failure, a candidate build or install failure,
a positive lint delta, a new vulnerability ID, or a probe mismatch the plan did not predict as a stated
behavioural difference. A pre-existing baseline failure is never a reason to reject.

Your veto is final. The Migrator may retry; it may not overrule you.

## Veto reasons

The engine writes veto reasons deterministically as short factual sentences naming the test, file, probe or
vulnerability ID, so they cannot be softened. The model's only task in this stage is choosing black-box probes
(see `blackbox-probe-diff`).
