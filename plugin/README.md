# Themis plugin for Claude Code

Rank risky npm and Python (pip) dependencies and migrate one on its own branch, verified against your base branch, from inside
Claude Code. Claude Code is the model, so no API key is needed. Part of [Themis](../README.md).

## Install

In Claude Code, add this repository as a marketplace, then install the plugin from it:

```text
/plugin marketplace add SatyamPandey-07/H26_UntrainedModels_THEMIS
/plugin install themis@themis
```

Run `/reload-plugins` (or start a new session) and the two skills below are available. Contributors who open this
repository in Claude Code are offered the plugin automatically through `.claude/settings.json`.

## Usage

| Command                     | What it does                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/themis:scan`              | Ranks direct dependencies by risk and recommends one. Read-only.                                                                                                                                          |
| `/themis:migrate [package]` | Maps usage, plans, edits on a `themis/<package>-<date>` branch, writes characterization tests, verifies against the base branch, and writes the capsule. Without a package, migrates the recommended one. |

Results are written to `.themis/runs/<runId>/` in your repository. The branch stays local; Themis never pushes.

## Requirements

- Node.js 22 or later and Git on your PATH
- A git repository with a `package.json`
- Optional: Docker, for isolated verification. Without it, verification runs on your machine and the capsule
  records that isolation was not verified.
- Optional: Opengrep, OSV-Scanner and Trivy for full analysis. Missing tools are reported as gaps.
- Optional: `GROQ_API_KEY`, to run the whole pipeline headless with `themis run`.

## How it works

The plugin ships the Themis CLI as `themis` on Claude Code's PATH (`bin/themis`, bundled in `dist/themis.mjs`) and
the engine skills in `engine/skills/`. In `/themis:migrate`, Claude Code writes the plan, the code edits and the
tests; the CLI step commands do everything deterministic and record evidence:

| Step                                         | Command                                               |
| -------------------------------------------- | ----------------------------------------------------- |
| Scan and map usage                           | `themis step map <package>`                           |
| Validate the plan draft                      | `themis step plan <runDir> <draft.json>`              |
| Branch and deterministic commits             | `themis step branch <runDir>`                         |
| Commit Claude's edits                        | `themis step commit <runDir> <concernId> "<summary>"` |
| Keep only tests that pass on the base commit | `themis step tests <runDir> <files...>`               |
| Verify and write the capsule                 | `themis step verify <runDir>`                         |

Claims for Claude's own work are tagged `AI-RECOMMENDED` with the model `claude-code`.

## Rebuild

From the repository root, after changing `packages/core` or `skills/`:

```bash
pnpm plugin:build
```
