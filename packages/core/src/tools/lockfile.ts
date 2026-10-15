import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DirectDependency {
  name: string;
  declaredRange: string;
  dev: boolean;
  installedVersion?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockEntry {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, LockEntry>;
}

export interface DependencyGraph {
  direct: DirectDependency[];
  /** Number of distinct packages reachable from each direct dependency (excluding itself). */
  transitiveCount: Map<string, number>;
  /** Direct dependencies that pull in each package name (for attributing transitive vulnerabilities). */
  parentsOf: Map<string, Set<string>>;
  source: string;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Resolves a dependency the way Node does in a package-lock v2/v3 tree: nearest node_modules upwards. */
function resolveLockPath(
  packages: Record<string, LockEntry>,
  fromPath: string,
  dep: string,
): string | undefined {
  let base = fromPath;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${dep}` : `node_modules/${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return undefined;
    const idx = base.lastIndexOf("/node_modules/");
    base = idx === -1 ? "" : base.slice(0, idx);
  }
}

/** Reads direct dependencies from package.json and, when package-lock.json exists, the resolved tree. */
export function readDependencyGraph(repoPath: string): DependencyGraph {
  const pkg = readJson<PackageJson>(join(repoPath, "package.json")) ?? {};
  const direct: DirectDependency[] = [
    ...Object.entries(pkg.dependencies ?? {}).map(([name, range]) => ({
      name,
      declaredRange: range,
      dev: false,
    })),
    ...Object.entries(pkg.devDependencies ?? {}).map(([name, range]) => ({
      name,
      declaredRange: range,
      dev: true,
    })),
  ];
  const transitiveCount = new Map<string, number>();
  const parentsOf = new Map<string, Set<string>>();

  const lockPath = join(repoPath, "package-lock.json");
  const lock = existsSync(lockPath) ? readJson<PackageLock>(lockPath) : undefined;
  const packages = lock?.packages;
  if (!packages) {
    for (const d of direct) transitiveCount.set(d.name, 0);
    return { direct, transitiveCount, parentsOf, source: "package.json" };
  }

  for (const d of direct) {
    const rootPath = resolveLockPath(packages, "", d.name);
    if (!rootPath) {
      transitiveCount.set(d.name, 0);
      continue;
    }
    d.installedVersion = packages[rootPath]?.version;
    const seen = new Set<string>([rootPath]);
    const queue = [rootPath];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const entry = packages[current] ?? {};
      const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
      for (const child of Object.keys(deps)) {
        const childPath = resolveLockPath(packages, current, child);
        if (!childPath || seen.has(childPath)) continue;
        seen.add(childPath);
        queue.push(childPath);
        const set = parentsOf.get(child) ?? new Set<string>();
        set.add(d.name);
        parentsOf.set(child, set);
      }
    }
    transitiveCount.set(d.name, seen.size - 1);
  }
  return { direct, transitiveCount, parentsOf, source: "package-lock.json" };
}
