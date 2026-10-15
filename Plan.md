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
- **Distribution (installable by any repo owner):**
  - **GitHub App (public, "Any account")** backed by one small hosted Probot server. The server only receives
    events, enforces limits, dispatches the pipeline and opens the draft PR and Check Run as the App. It holds the
    App private key; owners never see it.
  - **Themis Action** (`action.yml` in this repo): the heavy pipeline runs on the **owner's own Actions runners**,
    started by a one-file workflow the owner adds, using the owner's own `GROQ_API_KEY` secret.
  - **Claude Code plugin** distributed from this repo as a plugin marketplace.
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
action.yml          Themis Action (composite) used by owners' workflows
templates/          themis.yml workflow owners copy into .github/workflows/
.claude-plugin/     marketplace.json so developers can `/plugin marketplace add` this repo
render.yaml         hosting blueprint for the Probot server
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

### 13. GitHub App, Themis Action and owner workflow (`apps/github-app/`, `action.yml`, `templates/themis.yml`)
**Owner install flow:** install the public App on a repo → copy `templates/themis.yml` to `.github/workflows/` →
add the `GROQ_API_KEY` Actions secret. Nothing else.
**Themis Action** (composite): set up Node 22 → install pinned tools (`scripts/install-tools.sh`) → build core →
`themis run <pkg>` (or `scan`) on the checked-out repo → push `themis/<dep>-<date>` with the workflow's
`GITHUB_TOKEN` (`contents: write`) → upload `.themis/runs/<id>` as artifact `themis-capsule`.
**Owner workflow** triggers: `workflow_dispatch` (inputs: `package`, `mode`, sent by the App or by hand) and a
weekly `schedule` scan. It never runs on `pull_request`, so fork PRs never see secrets.
**Probot server** (hosted; Render free tier via `render.yaml`, smee for local dev):
- `issue_comment` `/themis <pkg>` and `issues.labeled` `themis` → check limits (one open Themis PR per dependency,
  `THEMIS_MAX_OPEN_PRS` cap) → react/acknowledge → dispatch the owner workflow.
- `workflow_run.completed` for `themis.yml` → download `themis-capsule` → open a **draft** PR from the pushed branch
  with the capsule PR body, labels `themis` + `ai-generated` → Check Run with conclusion and line annotations →
  signed alert webhook (`pr_opened` / `run_completed` / `run_failed`, retried once, never fails the run).
- If the workflow file or secret is missing, comment install instructions instead of failing silently.
**App permissions:** Contents, Pull requests, Checks, Issues, Actions = Read and write; Metadata = Read.
**Events:** Issue comment, Issues, Workflow run. Documented in `app.yml` (manifest).

### 14. Claude Code plugin and READMEs (`plugin/`, `.claude-plugin/marketplace.json`, all `README.md`)
Plugin with `/themis scan|plan|run <pkg>` commands calling the core CLI on the developer's checkout, plus the stage
skills. This repo is a marketplace: `/plugin marketplace add SatyamPandey-07/H26_UntrainedModels_THEMIS` →
`/plugin install themis@themis`. READMEs (root + core + github-app + plugin) written with `readmeskill`, including
the three-step owner install guide and Mermaid architecture; checker passing.

### 15. End-to-end verification — install on the WorkSphere fork like an owner would
Using only the owner install flow on the fork: install the App, add `templates/themis.yml`, add `GROQ_API_KEY`.
(a) Run the workflow with `mode=scan` → `themis-capsule` artifact with the ranked findings. (b) Comment
`/themis <top-ranked package>` on an issue → App acknowledges → workflow runs on the fork's runner → branch
`themis/<pkg>-<date>` → draft PR authored by the App with labels and capsule body → Check Run with annotations;
every EXECUTED claim links to an existing log; no write to `main`.

## Manual steps for the user (I'll prompt at the right step)

- [x] 1. **Docker socket:** no longer needed; sandboxes run on Actions runners.
- [x] 2. **smee channel:** no longer needed; Probot runs inside Actions (harmless if already created).
- [x] 3. **Register GitHub App:** done by the user. Re-check at step 13: public ("Any account"), permissions and
   events as listed in step 13, webhook URL pointing at the hosted server (smee URL during development).
- [x] 4. **Fork + install (step 15):** fork the demo-target repo to your account, install the App on the fork only.
- [ ] 5. **Alerts (optional):** create a webhook receiver (e.g. a webhook.site URL) → `ALERT_WEBHOOK_URL`.
- [x] 6. **Push access:** local `gh`/git switched to `ayushsshukla` (write access to this repo).
- [ ] 7. **Fork Actions:** enable Actions on the fork, then disable every inherited WorkSphere workflow so only
   `themis.yml` runs.
- [ ] 8. **Fork secret:** `GROQ_API_KEY` in the fork's Actions secrets (owner-side, like any installer).
- [ ] 9. **Host the Probot server:** deploy `render.yaml` on Render (free) with `APP_ID`, `PRIVATE_KEY`,
   `WEBHOOK_SECRET`; set the App's webhook URL to the Render URL.

## Verification

- Per feature (after it's complete): `pnpm lint && pnpm typecheck` clean, plus a minimal behaviour check
  that needs no installs (e.g. capsule gate downgrades a fake EXECUTED claim with a missing log). Anything needing
  scanners, Docker or the target repo is checked through a workflow run on the fork.
- Final: step 15 end to end, with the success metrics from the PRD checked in the produced capsule:
  verified-claim rate 100%, baseline recorded before judgement, 0 unreviewed regressions, call-site coverage reported.
