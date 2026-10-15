# Test shapes for Python

The test name carries the call-site tag from `call-site-tags.json` (for `src/dates.py:12` the tag is
`L12_src_dates_py`). Import project modules, never the dependency under migration.

## pytest

```python
# tests/test_themis_python_dateutil_characterization.py
import os
import time

os.environ["TZ"] = "UTC"
time.tzset()

from src.dates import parse_iso


def test_L12_src_dates_py_parse_iso():
    assert parse_iso("2024-01-31T10:00:00Z").isoformat() == "2024-01-31T10:00:00+00:00"


def test_L18_src_dates_py_parse_iso_date_only():
    assert parse_iso("2024-01-31").date().isoformat() == "2024-01-31"
```

## unittest

```python
# tests/test_themis_python_dateutil_characterization.py
import unittest

from src.dates import parse_iso


class Characterization(unittest.TestCase):
    def test_L12_src_dates_py_parse_iso(self):
        self.assertEqual(parse_iso("2024-01-31T10:00:00Z").isoformat(), "2024-01-31T10:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
```

## Rules

- Fixed inputs only; never read the current time, random numbers or the network.
- Assert concrete values, not types or truthiness.
- Put the file next to the existing tests so the runner collects it without extra configuration.
