import { slugify } from "../../util/misc.js";
import type { RuleFile } from "../types.js";

/** Deterministic import rule for a package, built from the skill's template patterns. */
export function importRule(pkg: string): RuleFile {
  const id = `themis-${slugify(pkg)}-import`;
  return {
    rules: [
      {
        id,
        languages: ["javascript", "typescript"],
        severity: "INFO",
        message: `imports ${pkg}`,
        metadata: { "themis-kind": "usage" },
        paths: { exclude: ["node_modules", "dist", "build", "coverage", ".themis"] },
        "pattern-either": [
          { pattern: `import $M from "${pkg}"` },
          { pattern: `import * as $M from "${pkg}"` },
          { pattern: `import { ... } from "${pkg}"` },
          { pattern: `const $M = require("${pkg}")` },
          { pattern: `require("${pkg}")` },
        ],
      },
    ],
  };
}
