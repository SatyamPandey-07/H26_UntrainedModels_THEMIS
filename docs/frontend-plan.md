# Themis web app: frontend plan

A SaaS frontend where a repository owner signs in with GitHub, picks repositories, is guided by a small robot,
and sees everything Themis does: scans, proposals, agent runs, draft pull requests and, above all, Dependency
Exit Capsules. Built and hosted on free tiers.

## Goals

1. **One-click start.** Sign in with GitHub, install the App on chosen repositories, and see the first scan without
   leaving the site.
2. **Everything visible.** Every scan, proposal, agent job, pull request and capsule claim has a page, linked to its
   evidence (log, file, commit, registry URL).
3. **Capsules are the product.** The capsule viewer is the best page in the app: verdict, why the dependency was
   chosen, what changed, what was proven, what was not.
4. **People decide.** Every action is a clear next step (Plan, Migrate, Dismiss), never something that runs on its
   own without asking.

## Design direction

Reference: the "Saasmo" board in the request. Airy lavender-white canvas, deep indigo primary, one lime accent,
large confident type, soft floating cards, generous radius.

### Colour tokens

| Token              | Light     | Dark      | Use                                                     |
| ------------------ | --------- | --------- | ------------------------------------------------------- |
| `--bg`             | `#F7F6FD` | `#0E0B1F` | Page background                                         |
| `--surface`        | `#FFFFFF` | `#17132E` | Cards                                                   |
| `--surface-2`      | `#EFECFB` | `#211C40` | Insets, table stripes                                   |
| `--ink`            | `#1B1640` | `#ECEAFB` | Primary text                                            |
| `--ink-muted`      | `#6B6790` | `#A39FC4` | Secondary text                                          |
| `--primary`        | `#3D1F99` | `#8B74F2` | Buttons, links, active states                           |
| `--primary-strong` | `#2A136E` | `#A898F7` | Hover, dark panels (the "Hiring list" card)             |
| `--accent`         | `#D7F25C` | `#D7F25C` | Single highlight per screen: verdict chips, key numbers |
| `--border`         | `#E4E1F5` | `#2C2650` | Hairlines                                               |
| `--focus`          | `#7C5CFA` | `#A898F7` | Focus rings (3px, offset 2px)                           |

Provenance tags get fixed, colour-blind-safe pairs (text and background both meet WCAG AA):

| Tag              | Colour                        | Icon     |
| ---------------- | ----------------------------- | -------- |
| `OBSERVED`       | Sky `#0B6BCB` on `#E3F1FD`    | eye      |
| `EXECUTED`       | Green `#1E7A3C` on `#E2F6E8`  | terminal |
| `AI-RECOMMENDED` | Violet `#5B2BC4` on `#EEE8FD` | sparkle  |
| `UNVERIFIED`     | Amber `#8A5300` on `#FDF1DC`  | question |

Verdicts: `Migrated and verified` lime chip, `Migrated, gaps remain` amber chip, `Not recommended` slate chip.

### Type, shape, motion

- **Type:** "Plus Jakarta Sans" for display and UI (geometric, close to the reference), "JetBrains Mono" for
  versions, commands and paths. Both on Google Fonts. Display 56/64 tight tracking; body 15/24.
- **Shape:** radius 20px cards, 14px inputs, full-pill buttons; one soft shadow (`0 12px 40px -12px rgb(61 31 153 / .18)`).
- **Motion:** Motion (Framer Motion) for page and card transitions, 180 to 260 ms, ease-out; respects
  `prefers-reduced-motion` (robot switches to a static pose, tour has no animation).
- **Iconography:** Lucide.

## The robot guide ("Tiko")

A small round robot with an antenna, two expressive eyes and a lime chest light, matching the logo palette.

| Option                                            | Cost                           | Verdict                                                                                                      |
| ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Rive** state machine (`@rive-app/react-canvas`) | Free plan, enough for one file | **Use.** Reacts at runtime: idle, wave, point left/right, think, cheer, sad. Inputs driven from React state. |
| Lottie (`@lottiefiles/dotlottie-react`)           | Free player                    | Fallback: pre-baked clips only, no runtime reactions                                                         |
| Hand-made SVG + Motion                            | Free                           | Static/reduced-motion fallback and favicon                                                                   |

Tiko appears in a corner dock and speaks in short speech bubbles. It never blocks the page. It is dismissible,
remembers "don't show again" per user, and its tips are plain text so screen readers announce them
(`aria-live="polite"`).

### Guided tour

**driver.js** (MIT, framework-agnostic, well maintained) wrapped in a small React hook; each step's bubble is
rendered by Tiko so the robot "points" at the highlighted element. Rejected: react-joyride (reported React 19
issues), Intro.js (commercial licence), Onborda (smaller community).

Tours:

1. **First run:** install App → choose repositories → first scan → read the dashboard → open a proposal.
2. **First capsule:** verdict → why → commits → verification → gaps → evidence links.
3. **Contextual hints:** first time on Runs, Settings, Plugin.

## Pages

### Marketing (public)

| Route               | Content                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | Hero in the reference style ("Dependency upgrades you can actually trust"), floating cards showing a live-looking capsule, verdict chip and agent timeline; "Sign in with GitHub" and "See a sample capsule". How it works (six agents), the four provenance tags, Plugin section, FAQ |
| `/capsule/sample`   | A real capsule from the WorkSphere demo, read-only                                                                                                                                                                                                                                     |
| `/how-it-works`     | The pipeline as an animated diagram: Argus → Athena → Hephaestus → Minos (two sandboxes) → Clio                                                                                                                                                                                        |
| `/pricing`          | Free for public repositories                                                                                                                                                                                                                                                           |
| `/privacy`, `/docs` | Rendered from `PRIVACY.md` and the READMEs                                                                                                                                                                                                                                             |

### App (signed in)

| Route                               | What it shows                                                                                                                                                            | Key actions                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `/onboarding`                       | Three steps with Tiko: connect GitHub, choose repositories (installs the App with exactly those repos), first scan running live                                          | Install, Skip tour                                 |
| `/dashboard`                        | Overview across repositories: risk distribution, candidates awaiting a decision, open draft PRs, runs in progress, capsule verdict mix, provenance mix over time         | Open proposal, Open run                            |
| `/repos`                            | Connected repositories with last scan, top risk, open Themis PRs                                                                                                         | Add repositories (App installation page), Scan now |
| `/repos/[owner]/[repo]`             | Ranked dependencies with the risk breakdown per row, blast radius, proposals, history of capsules                                                                        | **Plan**, **Migrate**, Dismiss, Ignore             |
| `/repos/[owner]/[repo]/deps/[name]` | One dependency: signals, vulnerabilities, usage map (files and lines), past plans and capsules                                                                           | Plan, Migrate                                      |
| `/runs`                             | Every run: mode, repository, package, status, duration, verdict                                                                                                          | Filter by repo/status                              |
| `/runs/[id]`                        | **Agent timeline**: the six agents as connected boxes (the Minos sandboxes side by side), live status from Actions jobs, each box expandable to its job summary and logs | Re-run, Open PR                                    |
| `/capsules`                         | All capsules with verdict, confidence, coverage, downgrades                                                                                                              | Filter by verdict/tag                              |
| `/capsules/[id]`                    | **Capsule viewer** (below)                                                                                                                                               | Open PR, Download JSON, Copy link                  |
| `/settings/[owner]/[repo]`          | Form editor for `.github/themis.yml` (auto-migrate, interval, ignore list, PR limit, proposals); saves via a PR from the App                                             | Save as PR                                         |
| `/plugin`                           | Claude Code plugin install command and what each command does                                                                                                            | Copy command                                       |

### Capsule viewer

1. **Header:** dependency `from → to`, verdict chip, confidence, coverage ring (`n of m` call sites), run link.
2. **Why this dependency:** score breakdown as a horizontal stacked bar (vulnerabilities, deprecation, age,
   maintainers, majors behind, transitive), blast radius, "selected by Themis" or "requested".
3. **What changed:** commits as a vertical timeline, each with its agent avatar and a diff preview.
4. **Verification:** default branch and this branch side by side (install, tests, lint, security), new failures
   highlighted, probe mismatches.
5. **Claims:** every claim as a row with its provenance chip; filter chips by tag; each evidence item links to the
   log line, file and line on GitHub, or registry URL. Downgraded claims are pinned at the top with the reason.
6. **Gaps and unresolved:** always visible, never collapsed.
7. **Raw:** `capsule.json` and `capsule.md` download.

## Architecture

```text
apps/web (Next.js 16, App Router, React 19)
├── app/(marketing)/…      static, statically rendered
├── app/(app)/…            signed-in pages, server components + TanStack Query for live parts
├── app/api/auth/[...]      Auth.js GitHub provider (the App's own OAuth client: one identity, no extra app)
├── app/api/actions/…       Plan / Migrate / Scan → repository_dispatch (same path as `/themis` comments)
└── lib/github/…            Octokit with the user's token (what they can see) and an installation token (Themis data)
```

**Data without a database (v1).** GitHub already stores everything Themis produces:

| Data                             | Source                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Repositories the user can manage | `GET /user/installations` + `/user/installations/{id}/repositories` (user token)           |
| Dashboard, proposals, comments   | Issues labelled `themis`                                                                   |
| Draft PRs and check runs         | Pulls and Checks APIs                                                                      |
| Runs and agent jobs              | Runner repository's workflow runs and jobs (`run-name` carries repo, mode and package)     |
| Findings, plan, capsule, logs    | `themis-run` artifact of each run; `capsule.json` committed under `.themis/` on the branch |

Responses are cached with Next.js data cache (60 s) and revalidated by the webhook server on new events.
**v2:** Neon Postgres free tier for history and charts across months, filled by the webhook server.

**Security.** User tokens stay in an encrypted Auth.js session cookie; installation tokens are minted server-side
per request. The app only shows repositories where the signed-in user has access. Actions (Plan, Migrate) require
write permission on the repository, checked server-side, exactly like `/themis` comments.

## Stack (all free tiers)

| Concern       | Choice                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js 16, React 19, TypeScript                                                                                                                           |
| Styling       | Tailwind CSS v4 with the tokens above, shadcn/ui primitives (Radix) restyled                                                                               |
| Motion        | Motion (Framer Motion)                                                                                                                                     |
| Robot         | Rive runtime (`@rive-app/react-canvas`); SVG fallback                                                                                                      |
| Tour          | driver.js                                                                                                                                                  |
| Charts        | Recharts (themed with the tokens)                                                                                                                          |
| Data          | Octokit, TanStack Query                                                                                                                                    |
| Auth          | Auth.js v5, GitHub provider using the Themis App's OAuth credentials                                                                                       |
| Hosting       | Vercel Hobby (same project as the webhook server, or a sibling project)                                                                                    |
| Design skills | `impeccable` and `ui-ux-pro-max` installed after a review of their files; existing `design-taste-frontend` and `high-end-visual-design` for the audit pass |

## Build sequence

| #   | Step                                                                                                                     | Done when                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| F0  | Install and review `impeccable` and `ui-ux-pro-max`; fix the webhook server (FUNCTION_INVOCATION_FAILED)                 | Skills listed; deliveries return 200                                 |
| F1  | `apps/web` scaffold, tokens, fonts, light/dark, shadcn primitives restyled                                               | Token page renders in both themes                                    |
| F2  | GitHub sign-in (App OAuth), session, protected routes                                                                    | Sign in shows the user's installations                               |
| F3  | Repository selection: list installations and repos; "Add repositories" opens the App installation page with a return URL | New repo appears after install                                       |
| F4  | Data layer: Octokit services for issues, PRs, checks, runs, jobs, artifacts, capsule JSON                                | Typed functions return WorkSphere data                               |
| F5  | Dashboard and repository pages, Plan/Migrate/Dismiss actions                                                             | Clicking Plan posts the same dispatch as `/themis plan`              |
| F6  | Runs list and agent timeline (live job status, summaries, logs)                                                          | A running job animates in its box                                    |
| F7  | Capsule viewer                                                                                                           | WorkSphere PR #8 capsule renders fully, every evidence link resolves |
| F8  | Tiko robot (Rive file + states) and driver.js tours                                                                      | First-run tour completes end to end; reduced-motion fallback works   |
| F9  | Marketing pages in the reference style, sample capsule                                                                   | Lighthouse ≥ 95 performance and accessibility                        |
| F10 | Settings editor for `.github/themis.yml` (saves as a PR)                                                                 | Saving opens a PR with the YAML                                      |
| F11 | Polish: `impeccable` audit/polish passes, empty/loading/error states, keyboard and screen-reader pass                    | No critical audit findings                                           |
| F12 | Deploy to Vercel, README via `readmeskill`                                                                               | Public URL, docs updated                                             |

## Manual steps

1. Add `https://<web-domain>/api/auth/callback/github` as a callback URL on the Themis App and enable "Request user
   authorization (OAuth) during installation" so installing also signs the user in.
2. Vercel env for `apps/web`: `AUTH_SECRET`, `AUTH_GITHUB_ID` (App Client ID), `AUTH_GITHUB_SECRET` (App client
   secret), `APP_ID`, `PRIVATE_KEY`, `RUNNER_REPO`.
3. Optional: Rive account (free) to edit the robot; the `.riv` file is committed to the repo.

## Research notes

- Impeccable install and scope: [skills.sh](https://skills.sh/pbakaus/impeccable/frontend-design),
  [ui-skills.com](https://www.ui-skills.com/skills/pbakaus/impeccable); comparison with ui-ux-pro-max:
  [skillselion](https://skillselion.com/compare/plugins/build/pbakaus/impeccable/vs/nextlevelbuilder/ui-ux-pro-max-skill).
- Rive versus Lottie for interactive characters: [pkgpulse](https://www.pkgpulse.com/guides/lottie-vs-rive-vs-css-animations-web-animation-formats-2026),
  [Rive review](https://makerstack.co/reviews/rive-review/).
- Product tour libraries: [Chameleon](https://www.chameleon.io/blog/javascript-product-tours),
  [LogRocket](https://blog.logrocket.com/best-product-tour-js-libraries-frontend-apps/).
