# Themis — Implementation Plan

## Context

`Themis.pdf` (PRD, 18 pp.) specifies a multi-agent harness that finds risky dependencies, migrates one on
its own branch, verifies baseline vs candidate in Docker sandboxes, and opens a draft PR carrying a
**Dependency Exit Capsule** where every claim is tagged OBSERVED / EXECUTED / AI-RECOMMENDED / UNVERIFIED.
The repo (`SatyamPandey-07/H26_UntrainedModels_THEMIS`) is empty except a stub README, so this is a greenfield build.

Decisions confirmed with the user:
- **LLM:** Groq for every agent (own tool-calling loop in TypeScript; replaces the PRD's Claude Agent SDK).
- **v1 language:** Node.js/TypeScript target repos (npm audit, JS/TS Opengrep mapper).
- **Execution:** everything heavy (scanner installs, target `npm ci`, Docker sandboxes, the LLM pipeline) runs on
  **GitHub Actions runners**, never on the developer machine. Locally: code edits, lint and typecheck only.
- **Target repo:** a fork of [SatyamPandey-07/WorkSphere](https://github.com/SatyamPandey-07/WorkSphere)
  (Next.js 16, npm, Jest, ESLint, Node 22). Replaces the earlier `examples/demo-target` fixture.
- **Sandbox:** Docker on the `ubuntu-latest` runner (Docker preinstalled).
- **Bot:** Probot GitHub App run inside Actions with `@probot/adapter-github-actions`; the workflow mints an App
  installation token (`actions/create-github-app-token`) so branches, PRs and Check Runs are authored by the App.
  No webhook server, smee channel or tunnel is needed.
- **Pushing:** commits are pushed only when the user says so.

Standing rules: no test files in this repo, no test runs unless asked, lint/type errors always fixed, minimal
behaviour check after each finished feature, commits rotated randomly across the 3 team authors with no AI
co-author, all READMEs via `readmeskill`.

## Repository layout (separated codebase, pnpm workspace)

```text
packages/core/      engine: agents, llm, tools, sandbox, capsule, orchestrator, CLI bin `themis`
apps/github-app/    Probot app (thin shell over core)
plugin/             Claude Code plugin (thin shell over core)
skills/             15 agentskills.io skill folders (shared by core, app, plugin)
docker/             sandbox Dockerfile
scripts/            install-tools.sh (pinned opengrep, osv-scanner, trivy; run on the Actions runner)
.github/workflows/  themis-run.yml template copied into the target fork
```

## Progress

- [x] 1. Workspace scaffold and secrets
- [x] 2. Contracts, run state and evidence logging
- [x] 3. Skills (15, agentskills.io format)
- [x] 4. Groq LLM client and agent loop
- [ ] 5. Analysis tools and wrappers
- [ ] 6. Argus — Scout
- [ ] 7. Athena — Planner
- [ ] 8. Docker sandbox
- [ ] 9. Hephaestus — Migrator
- [ ] 10. Minos — Verifier
- [ ] 11. Clio — Capsule Writer and PR report
- [ ] 12. Hermes — Orchestrator and CLI
- [ ] 13. GitHub App (Probot)
- [ ] 14. Claude Code plugin and READMEs
- [ ] 15. End-to-end verification — fork and run the app

## Tracking

This plan is copied verbatim to `Plan.md` at the repo root as the first action and committed.
Each phase has a checkbox under **Progress** (`[ ]` → `[x]`); it is ticked in `Plan.md` and committed together with
that phase's final commit, only after lint/typecheck pass and the minimal behaviour check is done.
Manual user steps are checkboxes too.

## Steps (in sequence)

### 1. Workspace scaffold and secrets
pnpm workspace, TypeScript (strict, ESM, Node 24), ESLint + Prettier, root `lint`/`typecheck`/`build` scripts.
`.gitignore` covers `.env`, `.themis/`, `node_modules`, `dist`, `*.pem`.
`GROQ_API_KEY` goes **only** in root `.env` (gitignored); `.env.example` lists `GROQ_API_KEY`, `GROQ_MODEL`,
`APP_ID`, `PRIVATE_KEY_PATH`, `WEBHOOK_SECRET`, `WEBHOOK_PROXY_URL`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`,
`THEMIS_RETRY_CAP=2`, `THEMIS_MAX_OPEN_PRS=3`. Config loaded and validated with zod in `packages/core/src/config.ts`;
the key is never logged or passed to agents/sandboxes. Optionally `gh secret set GROQ_API_KEY` on the repo
(needs repo admin — confirm with the user before running).

### 2. Contracts, run state and evidence logging (`packages/core/src/schema/`, `evidence/`)
zod schemas + inferred types for `findings.json`, `plan.json`, `verification.json`, `capsule.json`, `Claim`
(`tag`, `agent`, `text`, `evidence: {file,line}|{url}|{cmd,exitCode,logPath}|{inputs}`).
Run dir `.themis/runs/<runId>/` with `state.json`, `logs/`. `runCommand()` wrapper (execa) records exact
command, exit code, duration, tool version and log path — the only way any stage runs a process (shared skill
`evidence-logging`).

### 3. Skills (15, agentskills.io format) (`skills/`)
Agent skills: `stage-routing`, `retry-policy`, `toolchain-detect`, `dependency-risk-rank`, `opengrep-rule-author`,
`usage-map`, `migrate-dependency`, `characterization-tests`, `sandbox-verify`, `blackbox-probe-diff`,
`capsule-write`, `pr-report`. Shared: `provenance-tagging`, `untrusted-input-guard`, `evidence-logging`.
Each: valid `name` = folder, description ≤1024 chars with triggers, `compatibility` where tools needed,
`scripts/` wrappers, `references/` (e.g. Opengrep rule patterns), `assets/` (capsule.md + PR body templates).
Loader in `core/src/skills/loader.ts` parses frontmatter and returns owner + shared skills per agent.
Validate with `pnpm skills:validate` (spec rules implemented in `core/src/skills/validate.ts`; the official `skills-ref` could not be fetched offline).
Use the `agentskills` MCP (`search_agent_skills`) while drafting.

### 4. Groq LLM client and agent loop (`core/src/llm/`, `core/src/agents/base.ts`)
`groq-sdk` client; model from `GROQ_MODEL`, default `openai/gpt-oss-120b` (confirmed available with tool
calling on 2026-10-15; `openai/gpt-oss-20b` as a cheaper fallback). `runAgent({name, skills, tools, input, outputSchema})`:
system prompt = agent role + loaded SKILL.md bodies; tool-calling loop with step cap; final answer must parse
against the zod output schema (one repair retry). Repo text is wrapped in `<untrusted_data>` blocks; tools are
scoped per agent (read-only for Scout/Planner); 429/5xx backoff. Every model output is stored as AI-RECOMMENDED
with its inputs.

### 5. Analysis tools and wrappers (`scripts/install-tools.sh`, `core/src/tools/`)
`scripts/install-tools.sh` installs pinned Opengrep, OSV-Scanner and Trivy (checksums verified) **on the Actions
runner**, never locally; missing tools are reported as UNVERIFIED, not crashes. Typed wrappers (via `runCommand`):
`osvScan`, `trivyFs`, `npmAudit`, `opengrepRun(rules, target, {autofix})`, `npmRegistryInfo` (deprecation, last
publish, maintainers, weekly downloads), `gitBlame`. Interfaces `Scanner`, `Mapper`, `Linter` so a second language
is a new module (PRD extensibility). SonarQube stays a stub behind the interface (cut list #1).

### 6. Argus — Scout (`core/src/agents/scout.ts`)
Deterministic toolchain detection from lockfile/package.json/config (language, package manager, test runner,
formatter, linters); lint baseline on read-only `main` (detached worktree). Risk ranking = scored blend of
vulnerabilities, deprecation, age, maintainer count, transitive weight (`npm ls --all --json`); LLM only writes
the rationale. Proposes minimal lint config when none exists (F1). Output `findings.json`, all facts OBSERVED.

### 7. Athena — Planner (`core/src/agents/planner.ts`)
LLM authors an Opengrep rule per target dependency (imports, requires, member calls), validated by running it;
matches → usage map (file, line, symbol). Then migration strategy: target replacement/version, ordered
concerns, which call sites have deterministic `fix:` rules vs need model edits. Output `plan.json` + rule files.

### 8. Docker sandbox (`docker/sandbox.Dockerfile`, `core/src/sandbox/`)
Node 22 image (matches WorkSphere `.nvmrc`). Built on the Actions runner. Per build: `git archive` export, `npm ci` with network, then run with `--network none`, `--memory`,
`--cpus`, `--pids-limit`, `--read-only` source mount + tmpfs workdir. API: `buildImage(ref)`,
`exec(image, cmd)` (logged through evidence), `startService(image, port)` for probes. Identical setup for both refs.

### 9. Hephaestus — Migrator (`core/src/agents/migrator.ts`)
`git worktree add` on `themis/<dep>-<YYYYMMDD>` (never `main`). Commits, one per concern: toolchain/lint config →
dependency swap in package.json/lockfile → Opengrep autofixes → model edits (file-scoped edit tool) →
characterization tests. Characterization tests generated for touched call sites, run on **main** first in the
sandbox; only passing ones kept, failures recorded as gaps (F6). Accepts Verifier failure logs on retry.

### 10. Minos — Verifier (`core/src/agents/verifier.ts`)
Builds baseline and candidate sandboxes; runs tests, lint, Opengrep, Trivy in both with identical commands.
Tests are scoped to keep runner time sane on WorkSphere: `jest --findRelatedTests <touched files>` plus the
characterization tests (full suite optional via input). Black-box probes target routes that work without external
services (DB, Clerk); when none exist, probes are recorded as UNVERIFIED (PRD cut list #2);
black-box probes (same HTTP requests to both, diff responses, F10); computes delta only (new failures, lint/security
delta, call-site coverage n of m). Holds veto; on failure returns logs to Migrator up to `THEMIS_RETRY_CAP` (F9),
then marks unresolved. Output `verification.json` with log paths.

### 11. Clio — Capsule Writer and PR report (`core/src/capsule/`)
Pure deterministic code, no model. Builds `capsule.json` (schema-validated) and `capsule.md` with all PRD
sections; **gate:** any EXECUTED claim whose `logPath` doesn't exist is downgraded to UNVERIFIED and listed.
Verdict: `Migrated and verified` / `Migrated, gaps remain` / `Not recommended`. PR body per PRD layout
(verdict + confidence, summary table, provenance legend, collapsible sections, gaps always present, capsule link).
Capsule always produced, including on failure.

### 12. Hermes — Orchestrator and CLI (`core/src/orchestrator.ts`, `core/src/cli.ts`)
Sequences Scout → Planner → Migrator ⇄ Verifier → Clio, persists `state.json` after each stage (resumable),
enforces retry cap and step/time limits, emits alert events. Public API `runThemis({repoPath, dependency?, mode})`
used by all surfaces. CLI: `themis scan`, `themis plan <pkg>`, `themis run <pkg>`.
**Gate (PRD):** one dependency verified end to end on the WorkSphere fork via a `workflow_dispatch` run before
steps 13–14.

### 13. GitHub App (Probot on Actions) (`apps/github-app/`, `.github/workflows/themis-run.yml`)
Probot app function run by `@probot/adapter-github-actions` inside a workflow committed to the fork.
Triggers: `issue_comment` `/themis <pkg>`, `issues` labeled `themis`, weekly `schedule`, `workflow_dispatch`
(input: package). Workflow: checkout fork + Themis repo → install tools → build → mint App token →
`runThemis` → push branch → draft PR labeled
`themis` + `ai-generated` → Check Run with annotations on affected lines → capsule committed under `.themis/`.
Limits: one open Themis PR per dependency, `THEMIS_MAX_OPEN_PRS` concurrency cap, skip fork PRs. Permissions:
contents, pull requests, checks, issues (write); `app.yml` manifest documents them. Secrets live only in the
fork's Actions secrets: `GROQ_API_KEY`, `THEMIS_APP_ID`, `THEMIS_APP_PRIVATE_KEY` (optional
`ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`). Alert webhook: signed (HMAC-SHA256)
JSON POST for `pr_opened` / `run_completed` / `run_failed`, retried once, never fails the run.

### 14. Claude Code plugin and READMEs (`plugin/`, all `README.md`)
Plugin manifest, `/themis` command with `scan|plan|run` calling the core CLI, skills referenced from `skills/`.
READMEs (root + core + github-app + plugin) written with `readmeskill`, Mermaid architecture,
checker passing.

### 15. End-to-end verification — fork and run the app
On the WorkSphere fork, entirely on Actions: (a) `workflow_dispatch` scan run → `findings.json` artifact with the
ranked list; (b) comment `/themis <top-ranked package>` on an issue → workflow run → branch `themis/<pkg>-<date>`,
draft PR (labels `themis`, `ai-generated`) authored by the App, Check Run with annotations, capsule under `.themis/`
and as a run artifact, every EXECUTED claim linking to an existing log, no write to `main`.

## Manual steps for the user (I'll prompt at the right step)

- [x] 1. **Docker socket:** no longer needed; sandboxes run on Actions runners.
- [x] 2. **smee channel:** no longer needed; Probot runs inside Actions (harmless if already created).
- [x] 3. **Register GitHub App (step 13):** run `pnpm --filter github-app start` once → open `http://localhost:3000` →
   "Register GitHub App" (Probot manifest flow writes `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET` to `.env`).
- [x] 4. **Fork + install (step 15):** fork the demo-target repo to your account, install the App on the fork only.
- [ ] 5. **Alerts (optional):** create a webhook receiver (e.g. a webhook.site URL) → `ALERT_WEBHOOK_URL`.
- [x] 6. **Push access:** local `gh`/git switched to `ayushsshukla` (write access to this repo).
- [ ] 7. **Fork Actions:** enable Actions on the fork, then disable every inherited WorkSphere workflow so only
   `themis-run.yml` runs.
- [ ] 8. **Fork secrets:** `GROQ_API_KEY`, `THEMIS_APP_ID`, `THEMIS_APP_PRIVATE_KEY` in the fork's Actions secrets.
- [ ] 9. **App permissions check:** Contents, Pull requests, Checks, Issues = Read and write; Metadata = Read.

## Verification

- Per feature (after it's complete): `pnpm lint && pnpm typecheck` clean, plus a minimal behaviour check
  that needs no installs (e.g. capsule gate downgrades a fake EXECUTED claim with a missing log). Anything needing
  scanners, Docker or the target repo is checked through a workflow run on the fork.
- Final: step 15 end to end, with the success metrics from the PRD checked in the produced capsule:
  verified-claim rate 100%, baseline recorded before judgement, 0 unreviewed regressions, call-site coverage reported.
