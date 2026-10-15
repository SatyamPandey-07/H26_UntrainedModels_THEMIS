# Themis — Implementation Plan

## Context

[`docs/Themis-PRD.pdf`](docs/Themis-PRD.pdf) (PRD, 18 pp.) specifies a multi-agent harness that finds risky dependencies, migrates one on
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
- **Distribution: install-only, zero config.**
  - **GitHub App:** a repo owner clicks *Install* and is done. No workflow file, no secrets, no config file. The
    App scans on install, opens a Dependency Dashboard issue, and migrates when the owner ticks a box or
    comments `/themis <pkg>`.
  - **Claude Code plugin:** a developer runs `/plugin install` and is done. In plugin mode **Claude Code itself is
    the reasoning model** (it follows the stage skills), so no API key is needed; the core CLI does every
    deterministic step.
  - **Where work runs:** a small webhook server (Probot on Vercel serverless) receives events and sends a
    `repository_dispatch` to the **Themis runner workflow** in a repository we own. The pipeline runs on our
    GitHub Actions runners with our `GROQ_API_KEY` and the App's private key, so owners provide nothing.
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
.github/workflows/  themis-runner.yml: the pipeline, triggered by repository_dispatch from the App server
.claude-plugin/     marketplace.json so developers can `/plugin marketplace add` this repo
apps/github-app/vercel.json  serverless deployment of the webhook server
```

## Progress

- [x] 1. Workspace scaffold and secrets
- [x] 2. Contracts, run state and evidence logging
- [x] 3. Skills (15, agentskills.io format)
- [x] 4. Groq LLM client and agent loop
- [x] 5. Analysis tools and wrappers
- [x] 6. Argus — Scout
- [x] 7. Athena — Planner
- [x] 8. Docker sandbox (Docker path first exercised on the Actions runner at step 15)
- [x] 9. Hephaestus — Migrator (characterization-test validation first exercised on the runner at step 15)
- [x] 10. Minos — Verifier (delta and veto logic checked locally; Docker builds and probes first run on the runner at step 15)
- [x] 11. Clio — Capsule Writer and PR report
- [x] 12. Hermes — Orchestrator and CLI
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

### 13. GitHub App: webhook server, runner workflow, automatic UX (`apps/github-app/`, `.github/workflows/themis-runner.yml`)

**Owner experience (zero config)**
1. Owner installs the App on one or more repositories. Nothing else.
2. `installation.created` / `installation_repositories.added` → automatic **scan** of each repo (Scout only).
3. Themis opens or updates one **Dependency Dashboard** issue per repo: ranked dependencies with risk signals
   and a checkbox per dependency (`- [ ] Migrate moment`). Repos Themis cannot handle yet (no `package.json`,
   unsupported language) get a short dashboard saying so instead of silence.
4. Owner ticks a box (`issues.edited` on the dashboard), comments `/themis <pkg>`, or adds the `themis` label to an
   issue naming a package → migration run → **draft PR** authored by `<app>[bot]` with the capsule body, labels
   `themis` + `ai-generated`, a Check Run with line annotations, and a dashboard update linking the PR.
5. Weekly re-scan (scheduled runner job over all installations) refreshes every dashboard.

**Automatic decisions (no prompts, sensible defaults)**
- Language/toolchain, package manager, test and lint commands: detected (`toolchain-detect`).
- Default branch: read from the API; Themis only ever reads it.
- Migration target and strategy (upgrade vs replace): chosen by the Planner, stated in the PR with confidence.
- Auto-migrate: only the top-ranked dependency **with a known vulnerability or deprecation**, at most one per
  week per repo; everything else waits for a tick. Limits: one open Themis PR per dependency, 3 per repo.
- Optional `.github/themis.yml` lets owners override (ignore list, auto-migrate off, schedule); never required.
- Private repositories run only when the runner repository is private (no logs or artifacts of private code in a
  public repo); otherwise the dashboard explains why the run was skipped.

**Webhook server** (`apps/github-app/`, Probot `createNodeMiddleware`, deployed to Vercel free tier; smee for
local development): verifies signatures, applies limits, replies with an acknowledgement, and sends
`repository_dispatch` (`themis-run`, payload: repo, installation id, mode, package, trigger issue) to the runner
repo. Stateless; state lives in the dashboard issue and run artifacts.

**Runner workflow** (`themis-runner.yml`, in a runner repo we own; this repo by default):
- `prepare` job (App key): mint an installation token scoped to the target repo, read-only → clone the default
  branch → upload source as an artifact. Token is not passed on.
- `pipeline` job (`GROQ_API_KEY` only, no App key): install tools, run Scout → Planner → Migrator ⇄ Verifier →
  Clio. Repository code executes only inside Docker sandboxes, which receive no secrets.
- `publish` job (App key, no repo code executed): mint a write token → push `themis/<dep>-<date>` → draft PR →
  Check Run → dashboard update → signed alert webhook. On failure, the dashboard records the failed run.

**App permissions** (target repos): Contents, Pull requests, Checks, Issues = Read and write; Metadata = Read.
No Actions, Workflows, Secrets or Administration access is requested from owners.
**Events:** Installation, Installation repositories, Issues, Issue comment. Documented in `app.yml`.
**Marketplace readiness:** the server handles `marketplace_purchase` events (free plan: log the purchase,
cancellation and plan change; on cancellation stop runs for that account). The repo ships `PRIVACY.md` (what is
read, what is stored, Groq as subprocessor, retention of run artifacts) and support via GitHub Issues.

### 14. Claude Code plugin (zero config) and READMEs (`plugin/`, `.claude-plugin/marketplace.json`, `README.md`s)
Install: `/plugin marketplace add SatyamPandey-07/H26_UntrainedModels_THEMIS` → `/plugin install themis@themis`.
- `/themis` with no arguments: detect the repo, scan, print the ranked dashboard, and recommend the top item.
- `/themis migrate` with no package: migrates the recommended dependency; `/themis migrate <pkg>` for a specific one.
- Claude is the model: the plugin's skills are the same 15 skills, and Claude performs the model steps (rule
  authoring, plan, edits, probe choice). Deterministic steps are core CLI subcommands with JSON in/out:
  `themis scout`, `themis map --rules`, `themis branch`, `themis verify`, `themis capsule`. If `GROQ_API_KEY` is
  set, `themis run` can do everything headless instead.
- Output: a local branch and `.themis/` capsule, never a push. Docker is used when available; without it the
  verifier runs tests on the host and the capsule marks sandbox isolation as UNVERIFIED.
READMEs (root + core + github-app + plugin) written with `readmeskill`: one-click install for owners, plugin install
for developers, maintainer section for hosting the server and runner; Mermaid architecture; checker passing.

### 15. End-to-end verification — install on the WorkSphere fork like an owner would
Only action on the fork: **install the App**. Expect, with no other setup: (a) a runner run for the scan and a
Dependency Dashboard issue with ranked findings; (b) tick the top dependency → runner run → branch
`themis/<pkg>-<date>` → draft PR by `<app>[bot]` with labels and capsule body → Check Run with annotations →
dashboard links the PR; every EXECUTED claim links to an existing log; no write to `main`. Plugin check: install
the plugin in a scratch Claude Code session on a clone and run `/themis` (on the developer's machine, by choice).

## Manual steps for the user (I'll prompt at the right step)

- [x] 1. **Docker socket:** no longer needed; sandboxes run on Actions runners.
- [x] 2. **smee channel:** used only for local development of the webhook server; production uses Vercel.
- [x] 3. **Register GitHub App:** done by the user. Re-check at step 13: public ("Any account"), permissions and
   events exactly as in step 13 (no Actions permission), webhook URL = smee during development, Vercel later.
- [x] 4. **Fork + install (step 15):** fork the demo-target repo to your account, install the App on the fork only.
- [x] 5. **Alerts (optional):** create a webhook receiver (e.g. a webhook.site URL) → `ALERT_WEBHOOK_URL`.
- [x] 6. **Push access:** local `gh`/git switched to `ayushsshukla` (write access to this repo).
- [x] 7. **Runner secrets (this repo, maintainers only):** `GROQ_API_KEY`, `THEMIS_APP_ID`, `THEMIS_APP_PRIVATE_KEY`
   in Actions secrets of the runner repo. Owners never add secrets.
- [ ] 8. **Deploy the webhook server:** Vercel project from `apps/github-app` with `APP_ID`, `PRIVATE_KEY`,
   `WEBHOOK_SECRET`, `RUNNER_REPO`; point the App's webhook URL at it. The App is also installed on the runner repo,
   so the server dispatches runs with an installation token (`repository_dispatch` needs Contents write only).
- [ ] 9. **Install the App on the WorkSphere fork** (the only owner-side step). Fork Actions stay disabled; nothing
   runs on the fork's runners.
- [ ] 10. **App credentials:** generate the private key and a webhook secret; store them only in the runner repo's
   Actions secrets and the Vercel project (plus a local, gitignored copy for development).
- [x] 11. **GitHub Marketplace listing (after step 15 passes):** Developer settings → the App → *List in
   Marketplace*; free plan; descriptions, logo, feature card, screenshots from the WorkSphere demo; privacy policy
   (`PRIVACY.md`) and support (Issues) links; Marketplace webhook = the server URL; accept the developer agreement
   and *Submit for review*. Until approval, owners install from `https://github.com/apps/<app-slug>`.

## Verification

- Per feature (after it's complete): `pnpm lint && pnpm typecheck` clean, plus a minimal behaviour check
  that needs no installs (e.g. capsule gate downgrades a fake EXECUTED claim with a missing log). Anything needing
  scanners, Docker or the target repo is checked through a workflow run on the fork.
- Final: step 15 end to end, with the success metrics from the PRD checked in the produced capsule:
  verified-claim rate 100%, baseline recorded before judgement, 0 unreviewed regressions, call-site coverage reported.

## Remaining work: publish the GitHub App and plugin

### Remaining progress

Priority: a live run on GitHub first (workflow run, draft PR, Check Run and comment visible on the WorkSphere
fork), triggered by hand; automatic triggers and polish follow.

- [x] R1. Finish phase 12 check (CLI scan and plan)
- [x] R4a. Runner workflow (`workflow_dispatch`) and publish step: draft PR, Check Run, issue comment, dashboard (live check at R7a)
- [x] R6a. Manual: App private key, runner secrets, install the App on the WorkSphere fork
- [ ] R7a. First live run on the WorkSphere fork; fix what breaks
- [x] R3. Webhook server (Probot on Vercel): `/themis` comments, install-time scan, dashboard ticks (deploy at R6b)
- [ ] R6b. Manual: deploy to Vercel, point the App webhook at it
- [x] R2. Limits and optional `.github/themis.yml` config, weekly rescan
- [x] R5. PRIVACY.md and App README
- [ ] R7. Install-only end-to-end proof on the WorkSphere fork
- [x] R8. Claude Code plugin (validated with `claude plugin validate`)
- [ ] R9. GitHub Marketplace listing

### Architecture of the install flow

```text
owner installs App ──► GitHub webhook ──► Vercel (Probot, apps/github-app/api)
                                            │ verify signature, limits, ack comment
                                            ▼ repository_dispatch "themis-run" (installation token on runner repo)
                       SatyamPandey-07/H26_UntrainedModels_THEMIS  .github/workflows/themis-runner.yml
                         prepare  (App token, contents:read)  clone target → artifact
                         pipeline (GROQ_API_KEY only)          build core, install tools, themis scan|run, Docker
                         publish  (App token, write)           push branch, draft PR, Check Run, dashboard, alert
```

### Steps

On approval, `Plan.md` gets these steps appended as a tracked checklist (R1–R9) and is committed; each step is
ticked in the commit that completes it.

#### R1. Finish phase 12 check (local, light)
`themis scan` and `themis plan` through `packages/core/dist/cli.js` on the scratchpad fixture with the key
exported. Tick phase 12 in `Plan.md`.

#### R2. GitHub layer (`apps/github-app/src/`)
New workspace package `@themis/github-app` (Probot 14, `@octokit/rest`, `@octokit/auth-app`, imports
`@themis/core`). Pure modules shared by the server and the publish job:
- `dashboard.ts`: render the Dependency Dashboard issue from `findings.json` (hidden marker
  `<!-- themis:dashboard -->`, ranked table, one `- [ ] Migrate <pkg>` checkbox per dependency, linked open PRs,
  last-scan time and run link); parse newly ticked boxes from `issues.edited` (`changes.body.from` vs body).
- `limits.ts`: one open Themis PR per dependency (label `themis` + head `themis/<slug>-*`), max
  `THEMIS_MAX_OPEN_PRS` per repo, auto-migrate at most once per 7 days, private target refused while the runner
  repo is public; optional `.github/themis.yml` (ignore list, `autoMigrate`, schedule) parsed with zod.
- `dispatch.ts`: send `repository_dispatch` (`themis-run`, payload: repo, installation_id, mode, package,
  issue_number, trigger) to `RUNNER_REPO` using the App's installation on the runner repo.
- `publish.ts` (CLI entry used by the publish job): push branch from the pipeline's git bundle, commit the
  capsule to `.themis/<slug>/capsule.md` on the branch, open the draft PR (body from `pr-body.md`, labels
  `themis` + `ai-generated`, created if missing), Check Run on the head SHA (conclusion + ≤50 annotations from
  `check-run.json`), comment on the trigger issue, update the dashboard, send `pr_opened` alert via
  `sendAlert`. For scan runs: create/update the dashboard only. Reuse `capsuleRepoPath`, `sendAlert`,
  `recommendDependency` from `@themis/core`.

#### R3. Webhook server (`apps/github-app/src/app.ts`, `apps/github-app/api/github/webhooks.ts`)
Probot app function, deployed with `createNodeMiddleware` as a Vercel function (`vercel.json`); `smee` script for
local dev. Handlers (must answer within GitHub's 10 s, so they only validate and dispatch):
- `installation.created`, `installation_repositories.added` → dispatch a `scan` per repo (cap 20 per event).
- `issues.edited` on the dashboard by a human → dispatch `run` for each newly ticked package (limits apply).
- `issue_comment.created` `/themis <pkg>` or `/themis` (recommended) → short acknowledgement comment, dispatch `run`.
- `issues.labeled` `themis` → package from title/body, dispatch `run`.
- `marketplace_purchase.*` → log; on `cancelled` mark the account so further dispatches are refused.
- Ignore events from bots and from the runner repo itself.
`app.yml` documents permissions (Contents, Pull requests, Checks, Issues RW; Metadata R) and events.

#### R4. Runner workflow (`.github/workflows/themis-runner.yml`)
Triggers: `repository_dispatch` (`themis-run`), weekly `schedule`, `workflow_dispatch` (manual test inputs).
`concurrency: themis-${repo}-${package}`. Jobs:
- `prepare`: `actions/create-github-app-token` scoped to the target repo with `permission-contents: read`;
  refuse private targets when the runner repo is public; `git clone --filter=blob:none`; upload as artifact.
- `pipeline` (only `GROQ_API_KEY`): Node 22, pnpm install + build core, `scripts/install-tools.sh`, Docker
  available on `ubuntu-latest`; `themis scan|run --json`; upload `.themis/runs/<id>` and a `git bundle` of the
  `themis/*` branch.
- `publish`: App token with write permissions; `node apps/github-app/dist/publish.js`. Never executes target code.
- `rescan` (schedule only): list installations with `@octokit/auth-app`, dispatch `scan` for repos that have a
  dashboard issue.
Run artifacts retained 14 days.

#### R5. Docs for owners and maintainers
`PRIVACY.md` (data read, stored, Groq as subprocessor, artifact retention, deletion on uninstall), and
`apps/github-app/README.md` (owner install = one click; maintainer setup: secrets, Vercel, runner repo) plus
root README status update — all via `readmeskill` with the checker passing.

#### R6. Manual setup (user / Satyam, guided)
1. App: generate private key + webhook secret; confirm *Any account*, permissions and events from R3.
2. Runner repo Actions secrets (admin needed): `THEMIS_APP_ID`, `THEMIS_APP_PRIVATE_KEY`, `GROQ_API_KEY`.
3. Vercel: import repo, root `apps/github-app`, env `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`, `RUNNER_REPO`;
   set the App's webhook URL to `https://<project>.vercel.app/api/github/webhooks`.
4. Install the App on the runner repo and on the WorkSphere fork.

#### R7. End-to-end proof on the WorkSphere fork (phase 15)
Install only → dashboard issue appears with ranked dependencies → tick the top one → runner run → draft PR by
`<app>[bot]` with capsule body, labels and Check Run annotations → dashboard links the PR; every EXECUTED claim
has a log; `main` untouched. This is the first real run of Docker, Opengrep and the scanners: fix what breaks
(WorkSphere jest config, Prisma postinstall in the sandbox, run time) and re-run.

#### R8. Claude Code plugin (phase 14)
- `.claude-plugin/marketplace.json` at the repo root; `plugin/.claude-plugin/plugin.json`; `plugin/commands/themis.md`
  (`/themis`, `/themis migrate [pkg]`); `plugin/skills/` synced from `skills/` by `pnpm plugin:sync`.
- Zero install: core CLI bundled with esbuild into `plugin/bin/themis.mjs` (committed artifact, rebuilt by
  `pnpm plugin:build`).
- Claude as the model when `GROQ_API_KEY` is absent: CLI subcommands with JSON in/out — `scan --no-llm`,
  `map <pkg> [--rules file]`, `plan --from <draft.json>` (validates, adds AI-RECOMMENDED claims with model
  `claude-code`), `branch <pkg>`, `commit-concern`, `verify`, `capsule`. With a key, `run` does everything headless.
- Confirm current plugin/marketplace manifest format with the `claude-code-guide` agent before writing it.
- `plugin/README.md` via `readmeskill`.

#### R9. GitHub Marketplace listing (after R7 passes)
Logo, feature card and screenshots from the R7 demo (images via the `brandkit` skill or real screenshots);
listing copy; free plan; privacy (`PRIVACY.md`) and support (Issues) links; Marketplace webhook = Vercel URL;
accept the developer agreement and *Submit for review*. Until approval, share `https://github.com/apps/<slug>`.

### Verification for remaining work

- Per step: `pnpm lint`, `pnpm typecheck`, `pnpm skills:validate`; README checker for any README.
- R2/R3 locally without network side effects: dashboard render/parse round-trip and limit decisions on fixture
  payloads; Probot handlers fed recorded webhook JSON with a stubbed Octokit (scratchpad only, no test files).
- R4: `workflow_dispatch` scan of the WorkSphere fork on the runner; artifacts contain `findings.json`.
- R7 is the acceptance test: install-only flow produces the dashboard and a verified draft PR.
- R8: in a scratch Claude Code session on a clone, `/plugin install`, `/themis` prints the ranking.
