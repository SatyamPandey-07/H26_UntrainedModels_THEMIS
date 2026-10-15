# Log format

## Log file: `logs/NNN-<label>.log`

```text
# command: npm test
# cwd: /tmp/themis-baseline
# started: 2026-10-15T07:24:00.060Z

<combined stdout and stderr>

# exit code: 1
# duration: 2140 ms
```

## Index: `evidence.jsonl` (one JSON object per line)

```text
{"seq":4,"label":"npm-test","command":"npm test","cwd":"/tmp/themis-baseline","exitCode":1,"logPath":"logs/004-npm-test.log","durationMs":2140,"timedOut":false,"at":"2026-10-15T07:24:00.060Z"}
```

## Run directory

```text
.themis/runs/<runId>/
├── state.json          stage status and events
├── tools.json          tool name -> version
├── evidence.jsonl      command index
├── logs/               one file per command
├── findings.json       Scout
├── plan.json           Planner
├── rules/              Opengrep rules
├── migration.json      Migrator
├── verification.json   Verifier
├── capsule.json        Clio
├── capsule.md          Clio
└── pr-body.md          Clio
```
