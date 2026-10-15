# Test shapes by runner

## Jest or Vitest (CommonJS project)

```js
process.env.TZ = "UTC";
const { formatDate } = require("../src/format");

describe("themis characterization: moment", () => {
  test("src/format.js:12 formatDate", () => {
    expect(formatDate("2024-01-31T10:00:00Z")).toBe("2024-01-31");
  });
});
```

## Jest or Vitest (ES modules)

```js
process.env.TZ = "UTC";
import { formatDate } from "../src/format.js";

test("src/format.js:12 formatDate", () => {
  expect(formatDate("2024-01-31T10:00:00Z")).toBe("2024-01-31");
});
```

## node:test

```js
process.env.TZ = "UTC";
const test = require("node:test");
const assert = require("node:assert/strict");
const { formatDate } = require("../src/format");

test("src/format.js:12 formatDate", () => {
  assert.equal(formatDate("2024-01-31T10:00:00Z"), "2024-01-31");
});
```
