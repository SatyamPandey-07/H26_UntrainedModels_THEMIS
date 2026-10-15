# Commit messages

Every Themis commit uses [Conventional Commits](https://www.conventionalcommits.org/). The subject is at most
72 characters, imperative, lower case after the type, with no trailing period. The engine builds the message
(`packages/core/src/messages.ts`); this table is the contract.

| Concern                | Subject                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `toolchain`            | `chore(lint): add a minimal lint configuration`                        |
| `dependency` (upgrade) | `build(deps): upgrade svix from 2.0.0 to 2.8.0`                        |
| `dependency` (replace) | `build(deps): replace moment 2.29.4 with dayjs 1.11.13`                |
| `autofix`              | `refactor(<dependency>): apply deterministic Opengrep fixes`           |
| `model-edit`           | `refactor(<dependency>): <concern title>`                              |
| `tests`                | `test(<dependency>): pin current behaviour of <dependency> call sites` |
| retry fix              | `fix(<dependency>): address verifier findings (attempt N)`             |
| capsule                | `docs(themis): add Dependency Exit Capsule for <dependency>`           |

Body: why the change was made (the plan rationale or concern instructions), then the model's per-file summary
for edits, then the files touched, wrapped at 72 columns.

Trailers, always last:

```text
Themis-Agent: Hephaestus (Migrator)
Themis-Concern: edit-1
Themis-Run: 20261015-094525-svix-1a2b
Themis-Model: openai/gpt-oss-120b
```

`Themis-Model` appears only on commits whose content a model wrote.
