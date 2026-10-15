# Privacy policy

This policy covers the Themis GitHub App ([`themis-migrations`](https://github.com/apps/themis-migrations)) and
the Themis Claude Code plugin. Last updated 2026-10-15.

## What the GitHub App reads

| Data                                                                                         | Why                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Source code, manifests and lockfiles on the default branch of repositories you install it on | Rank dependencies, map where they are used, migrate and verify one         |
| Issue and pull request titles, bodies and comments on those repositories                     | Read `/themis` commands, the `themis` label and Dependency Dashboard ticks |
| Repository metadata (name, visibility, default branch, labels, open pull requests)           | Route runs and apply limits such as one open pull request per dependency   |
| The optional `.github/themis.yml` file                                                       | Read your settings                                                         |

The App does not read secrets, Actions logs, deploy keys, organisation members or any repository you did not
select when installing it.

## Where your code is processed

- **GitHub Actions runners.** Each run executes in the Themis runner repository
  ([`SatyamPandey-07/H26_UntrainedModels_THEMIS`](https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS)).
  Your repository's code runs only inside Docker containers with no network access after dependencies install.
- **Groq.** Excerpts of your code (the files the agents read, usage snippets) and dependency metadata are sent to
  the [Groq API](https://groq.com/privacy-policy/) to plan the migration and write edits and tests. Groq is the
  only third-party processor.
- **Public registries.** Package names and versions are looked up on the npm registry, OSV and the Trivy
  vulnerability database.

The runner repository is public, so its Actions logs and run artifacts are public. For that reason the App
refuses to run on **private** repositories unless a maintainer configures a private runner repository.

## What is stored, and for how long

| Item                                                 | Where                                                 | Retention                                               |
| ---------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Run artifacts (stage outputs, command logs, capsule) | Actions artifacts of the runner repository            | 14 days                                                 |
| Cloned source of your repository during a run        | Ephemeral runner disk                                 | Deleted when the job ends (1-day artifact between jobs) |
| Dependency Exit Capsule                              | Committed to the `themis/*` branch in your repository | Until you delete the branch                             |
| Dependency Dashboard and comments                    | Issues in your repository                             | Until you delete them                                   |
| Webhook delivery logs                                | The App's hosting provider                            | Provider default                                        |

Themis has no database and keeps no copy of your code outside the places listed above.

## What the App writes

Branches named `themis/<dependency>-<date>`, draft pull requests, Check Runs, labels (`themis`, `ai-generated`),
one Dependency Dashboard issue and comments. It never writes to your default branch and never merges.

## Claude Code plugin

The plugin runs entirely on your machine. With no `GROQ_API_KEY` set, Claude Code is the model and nothing is
sent anywhere beyond what your Claude Code session already sends. With `GROQ_API_KEY` set, the headless `themis
run` command sends code excerpts to Groq as described above. The plugin never pushes branches.

## Removing your data

Uninstall the App from your repository or account settings to stop all processing. Run artifacts expire after 14
days; delete the `themis/*` branches, the Dependency Dashboard issue and comments to remove the rest. To request
earlier deletion of run artifacts, open an issue in the
[Themis repository](https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS/issues).

## Contact

Questions about this policy: open an issue in the
[Themis repository](https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS/issues).
