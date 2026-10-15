# Worked example: moment to dayjs

| moment                        | dayjs                                  | Behaviour note                                |
| ----------------------------- | -------------------------------------- | --------------------------------------------- |
| `require("moment")`           | `require("dayjs")`                     | Same default-export call style                |
| `moment()` / `moment(x)`      | `dayjs()` / `dayjs(x)`                 | dayjs objects are immutable                   |
| `m.add(n, unit)` mutates `m`  | `d = d.add(n, unit)`                   | Reassign; dayjs returns a new object          |
| `m.format("YYYY-MM-DD")`      | `d.format("YYYY-MM-DD")`               | Same tokens for common formats                |
| `m.fromNow()`                 | needs `dayjs/plugin/relativeTime`      | `dayjs.extend(relativeTime)` once per module  |
| `m.diff(other, "days")`       | `d.diff(other, "day")`                 | Unit names accept singular; plural also works |
| `moment.utc(x)`               | needs `dayjs/plugin/utc`               | `dayjs.extend(utc)` then `dayjs.utc(x)`       |
| `m.isValid()`                 | `d.isValid()`                          | Same                                          |
| `moment(x, fmt)` strict parse | needs `dayjs/plugin/customParseFormat` | Extend before use                             |
| `m.startOf("isoWeek")`        | needs `dayjs/plugin/isoWeek`           | Extend before use                             |

The mutability difference is the most common regression: code that calls `m.add()` without reassigning
silently stops working after the swap. Search every `add`, `subtract`, `startOf`, `endOf`, `set` call.
