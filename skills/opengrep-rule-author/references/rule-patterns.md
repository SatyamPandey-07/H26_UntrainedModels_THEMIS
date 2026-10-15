# Opengrep patterns for npm dependencies

Replace `PKG` with the package name. All examples are valid for `languages: [javascript, typescript]`.

## Import and require sites

```yaml
- id: themis-PKG-import
  languages: [javascript, typescript]
  severity: INFO
  message: imports PKG
  metadata: { themis-kind: usage }
  pattern-either:
    - pattern: import $M from "PKG"
    - pattern: import * as $M from "PKG"
    - pattern: import { ... } from "PKG"
    - pattern: const $M = require("PKG")
    - pattern: require("PKG")
```

## Calls through the imported binding

```yaml
- id: themis-PKG-call
  languages: [javascript, typescript]
  severity: INFO
  message: calls PKG
  metadata: { themis-kind: usage }
  patterns:
    - pattern-either:
        - pattern-inside: |
            $M = require("PKG");
            ...
        - pattern-inside: |
            import $M from "PKG";
            ...
    - pattern-either:
        - pattern: $M(...)
        - pattern: $M.$FN(...)
        - pattern: $M(...).$FN(...)
```

## Mechanical fix: change the module specifier

Use only when the new package exposes a compatible default export for every call in the usage map.

```yaml
- id: themis-PKG-swap-require
  languages: [javascript, typescript]
  severity: INFO
  message: swap PKG for NEWPKG
  metadata: { themis-kind: fix }
  pattern: require("PKG")
  fix: require("NEWPKG")
```

## Excluding paths

```yaml
paths:
  exclude: [node_modules, dist, build, coverage, .themis]
```

## Running

```bash
opengrep scan --config rules.yaml --json --metrics=off /path/to/repo
opengrep scan --config fix-rules.yaml --autofix --metrics=off /path/to/repo
```

The JSON output lists `results[]` with `check_id`, `path`, `start.line`, `end.line` and `extra.lines`.
