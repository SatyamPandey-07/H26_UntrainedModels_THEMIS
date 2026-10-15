# GitHub Marketplace listing

Copy for the Themis GitHub App listing, written to GitHub's
[listing description guidelines](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/writing-a-listing-description-for-your-app).
Create the draft from the App's settings page (**List in Marketplace**) or at
[github.com/marketplace/new](https://github.com/marketplace/new).

## Naming and links

| Field                                     | Value                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Listing name                              | Themis                                                                                            |
| Very short description (40–80 characters) | Verified dependency migrations with an evidence report for every claim                            |
| Primary category                          | Dependency management                                                                             |
| Secondary category                        | Security                                                                                          |
| Supported languages                       | JavaScript, TypeScript                                                                            |
| Customer support URL                      | https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS/issues                              |
| Privacy policy URL                        | https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS/blob/main/PRIVACY.md                |
| Documentation URL                         | https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS/blob/main/apps/github-app/README.md |

## Logo and feature card

| Field                   | Value                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Logo                    | [`assets/logo-512.png`](assets/logo-512.png) (512 × 512, transparent background; source [`assets/logo.svg`](assets/logo.svg)) |
| Badge background color  | `#DB2777`                                                                                                                     |
| Feature card background | [`assets/feature-card.png`](assets/feature-card.png) (965 × 482)                                                              |
| Feature card text color | `#FFFFFF`                                                                                                                     |

## Introductory description (150–250 characters)

Themis ranks your npm dependencies by risk, migrates one on its own branch, verifies it against your default
branch in a sandbox, and opens a draft pull request whose report separates what was run from what the AI suggests.

## Detailed description (up to 1,000 characters)

```markdown
### Install and nothing else

Themis scans each repository on install and opens a Dependency Dashboard. Tick a dependency or comment `/themis <package>` to start a migration.

### Verified against your default branch

Baseline and candidate build in identical sandboxes with no network after install. Only new test failures, lint violations, vulnerabilities, and leftover imports count.

### Tests that pin today's behaviour

Themis writes characterization tests for affected call sites and keeps only those that pass on the old version.

### Every claim tagged by its evidence

The report marks each statement as observed, executed, AI-recommended, or unverified, and an executed claim needs a log file.

### Draft pull requests only

Themis never merges and never writes to your default branch.
```

## Pricing plan

| Field         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| Plan name     | Free                                                                               |
| Pricing model | Free                                                                               |
| Description   | All features for public repositories                                               |
| Bullets       | Dependency Dashboard; draft pull requests with an evidence capsule; weekly rescans |

## Screenshots (up to 5, at least 1200 px wide, same aspect ratio)

Take these from the WorkSphere demo, browser content area only:

1. The Dependency Dashboard issue
2. A draft pull request body (verdict, summary table, provenance legend)
3. The Themis Check Run with annotations on the Files changed tab
4. The capsule's executed results table
5. A `/themis <package>` comment and the App's reply

## Before submitting

- The App's webhook points at the deployed server, and **Marketplace purchase** is among the subscribed events.
- The App requests only Contents, Pull requests, Checks and Issues (read and write) and Metadata (read). Remove
  Actions access and the Workflow run event, which Themis no longer uses.
- Accept the GitHub Marketplace Developer Agreement, then select **Submit for review** on the listing overview.
