---
name: provenance-tagging
description: Defines the four Themis provenance tags (OBSERVED, EXECUTED, AI-RECOMMENDED, UNVERIFIED) and the evidence each requires, so every claim an agent makes names how it was established and which agent produced it. Use whenever an agent states a fact, a result or a recommendation that may reach the capsule or PR.
metadata:
  shared: "true"
  version: "0.1"
---

# Provenance tagging

Every statement that can reach the capsule is a claim with exactly one tag.

| Tag            | Meaning                                        | Evidence required                           |
| -------------- | ---------------------------------------------- | ------------------------------------------- |
| OBSERVED       | A script read the repository or a registry API | file and line, or source URL                |
| EXECUTED       | A command ran in the sandbox or on the host    | exact command, exit code, log path          |
| AI-RECOMMENDED | A model reasoned over observed data            | model name and the inputs it saw            |
| UNVERIFIED     | Nothing backs it                               | a reason; listed openly as a gap or concern |

## Rules for model output

- Everything you, the model, write is AI-RECOMMENDED. You cannot produce OBSERVED or EXECUTED claims;
  only engine code that read a file or ran a command can.
- Never state that tests pass, a build succeeds, or a vulnerability is fixed unless that result was given
  to you as input. If you believe it but were not shown it, say it is unverified.
- Use cautious, specific language: "the usage map shows 4 calls to `add`" rather than "the code uses moment
  everywhere".
- State confidence (`low`, `medium`, `high`) when asked, and justify it from the inputs.
