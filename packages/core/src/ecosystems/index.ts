import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Toolchain } from "../schema/stages.js";
import { nodeEcosystem } from "./node/index.js";
import { pythonEcosystem } from "./python/index.js";
import { discoverRequirementsFiles } from "./python/requirements.js";
import type { Ecosystem, EcosystemId } from "./types.js";

export type { DependencyChange, EditContext, EditOutcome, Ecosystem, EcosystemId } from "./types.js";
export { nodeEcosystem, pythonEcosystem };

const BY_ID: Record<EcosystemId, Ecosystem> = { node: nodeEcosystem, python: pythonEcosystem };

export function ecosystemById(id: EcosystemId): Ecosystem {
  return BY_ID[id];
}

/** The ecosystem a toolchain belongs to (Python toolchains say `python`; everything else is Node). */
export function ecosystemFor(toolchain: Pick<Toolchain, "language">): Ecosystem {
  return toolchain.language === "python" ? pythonEcosystem : nodeEcosystem;
}

export function isEcosystemId(value: string | undefined): value is EcosystemId {
  return value === "node" || value === "python";
}

export function hasPythonManifest(repoPath: string): boolean {
  return discoverRequirementsFiles(repoPath).length > 0;
}

/**
 * Chooses the ecosystem for a repository: an explicit override wins, then package.json (Node), then
 * requirements files (Python). With neither, Node is returned so the original "no package.json" error surfaces.
 */
export function detectEcosystem(repoPath: string, override?: string): Ecosystem {
  const wanted = override ?? process.env.THEMIS_ECOSYSTEM;
  if (isEcosystemId(wanted)) return BY_ID[wanted];
  if (existsSync(join(repoPath, "package.json"))) return nodeEcosystem;
  if (hasPythonManifest(repoPath)) return pythonEcosystem;
  return nodeEcosystem;
}
