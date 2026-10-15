# Opengrep patterns for PyPI dependencies

Replace `MODULE` with the **import name** (see `usage-map/references/python-import-names.md`), not the
distribution name. All examples use `languages: [python]`.

## Import sites (the engine writes this rule for you)

Dotted and aliased imports vary too much for pattern syntax, so the import rule is regex based:

```yaml
- id: themis-PKG-import
  languages: [python]
  severity: INFO
  message: imports PKG
  metadata: { themis-kind: usage }
  pattern-regex: '(?m)^[ \t]*(?:import|from)[ \t]+(?:MODULE)(?:\.[\w.]+)?(?=[ \t,]|$)'
```

## Calls through the imported module

```yaml
- id: themis-PKG-call
  languages: [python]
  severity: INFO
  message: calls MODULE
  metadata: { themis-kind: usage }
  pattern-either:
    - pattern: MODULE.$FN(...)
```

## Calls to names imported with `from`

```yaml
- id: themis-PKG-from-call
  languages: [python]
  severity: INFO
  message: calls a name imported from MODULE
  metadata: { themis-kind: usage }
  patterns:
    - pattern-inside: |
        from MODULE import $FN
        ...
    - pattern: $FN(...)
```

## Aliased modules

When the file does `import MODULE as ALIAS`, match `ALIAS.$FN(...)` in a rule that uses
`pattern-inside: import MODULE as ALIAS ...`.
