---
name: blackbox-probe-diff
description: Chooses a small set of HTTP requests that exercise the routes reaching a migrated dependency, sends identical requests to the baseline and candidate apps running in their sandboxes, and diffs status codes and bodies. Use when verifying a migration of a web service, especially when unit tests are green but behaviour may still differ.
compatibility: Requires the app to start with a known command and listen on a known port inside the sandbox.
metadata:
  owner: minos
  version: "0.1"
---

# Black-box probe diff

## Choosing probes (your task)

From the usage map and the route definitions you are shown, return up to 6 probes:

```json
[{ "method": "GET", "path": "/api/due?days=3" }]
```

- Prefer routes whose handlers reach a call site in the usage map.
- Use fixed inputs in query strings and bodies. Avoid routes whose output depends on the current time
  unless no other route reaches the call site; such probes are reported but their mismatch is expected.
- Only `GET`, or `POST` with a small JSON body. Never send destructive requests.

## Diffing (engine)

Each probe runs against both apps with the same headers. Status codes must match. JSON bodies are compared
after key sorting; text bodies are compared exactly. Every mismatch is recorded with both bodies and is an
EXECUTED claim pointing at the probe log.
