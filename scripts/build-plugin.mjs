#!/usr/bin/env node
// Builds the Claude Code plugin: bundles the core CLI into one file and copies the engine skills and sandbox
// Dockerfile next to it, so an installed plugin needs no `npm install`.
import { chmodSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugin");

rmSync(join(plugin, "dist"), { recursive: true, force: true });
rmSync(join(plugin, "engine"), { recursive: true, force: true });

await build({
  entryPoints: [join(root, "packages/core/src/cli.ts")],
  outfile: join(plugin, "dist/themis.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  // Some dependencies are CommonJS and call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __themisCreateRequire } from 'node:module'; const require = __themisCreateRequire(import.meta.url);" },
});

mkdirSync(join(plugin, "engine"), { recursive: true });
cpSync(join(root, "skills"), join(plugin, "engine/skills"), { recursive: true });
cpSync(join(root, "docker"), join(plugin, "engine/docker"), { recursive: true });
chmodSync(join(plugin, "bin/themis"), 0o755);
console.log("plugin built: plugin/dist/themis.mjs, plugin/engine/{skills,docker}");
