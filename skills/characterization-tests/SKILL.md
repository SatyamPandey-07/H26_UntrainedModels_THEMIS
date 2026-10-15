---
name: characterization-tests
description: Writes characterization tests that pin the current behaviour of every call site a migration touches, using the repository's own test runner, so the same tests can prove the old dependency and the new one behave alike. Use when a migration plan has a tests concern, or when call-site coverage is below the number of touched sites.
metadata:
  owner: hephaestus
  version: "0.1"
---

# Characterization tests

## Goal

For each touched call site, a test that calls the project's own exported function (not the dependency
directly) and asserts the exact output it produces today.

## Rules

- Use the repository's test runner and style. Put files in its test directory, named
  `themis-<dep>.characterization.test.<ext>`.
- Tests must be deterministic. Pin inputs: pass fixed dates, never rely on the current time; set
  `process.env.TZ = "UTC"` at the top of the file when dates are involved.
- Assert concrete values (`expect(fn(x)).toBe("2024-01-31")`), not types or truthiness.
- Each test name includes the source file and line of the call site it covers, e.g.
  `src/format.js:12 formatDate`. The Verifier uses this to compute call-site coverage.
- Do not mock the dependency under migration.

## Keep or discard (enforced by the engine)

The tests are run against the **base branch** first. Only tests that pass on the old dependency are kept
and committed. Failing tests are discarded and listed under gaps with their log. Never edit a test until
it goes green; a test that fails on the base branch describes behaviour you got wrong.

See [references/test-shapes.md](references/test-shapes.md) for runner-specific templates (Jest, Vitest,
node:test) and [references/test-shapes-python.md](references/test-shapes-python.md) for pytest and unittest.

## Python repositories

- Name each file `test_themis_<dep>_characterization.py` (hyphens in the dependency name become underscores).
- Test names cannot contain `file:line`, so the engine gives each call site a tag, for example
  `L12_src_dates_py` for `src/dates.py:12`. Put the tag in the test function name
  (`test_L12_src_dates_py_parses_iso`); the Verifier counts a site as covered when a passing test name
  contains its tag.
