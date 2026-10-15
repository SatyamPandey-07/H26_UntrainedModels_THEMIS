---
name: evidence-logging
description: Requires every command Themis runs to record its exact command text, working directory, exit code, duration and full output to a log file, with an index entry in evidence.jsonl, so the Capsule Writer can gate EXECUTED claims. Use whenever a stage runs a process, or when checking whether a result has evidence behind it.
metadata:
  shared: "true"
  version: "0.1"
---

# Evidence logging

## Rules

- Every process runs through the engine's `runCommand`. No stage spawns processes another way.
- Each run writes `logs/NNN-<label>.log` under `.themis/runs/<runId>/` and appends one line to
  `evidence.jsonl`. Format: [references/log-format.md](references/log-format.md).
- Child processes receive a scrubbed environment: no Groq, GitHub App or webhook secrets.
- Tool versions are recorded once per run in `tools.json`.
- An EXECUTED claim cites the run-relative log path. If the log is missing at capsule time, Clio downgrades
  the claim to UNVERIFIED.

## For models

When you summarise a result you were given, cite its log path exactly as provided. Do not summarise logs
you were not shown.
