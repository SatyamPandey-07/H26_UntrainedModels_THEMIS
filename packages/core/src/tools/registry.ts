export interface RegistryInfo {
  name: string;
  url: string;
  latestVersion?: string;
  /** Highest version without a pre-release tag (dist-tags.latest can point at a release candidate). */
  latestStable?: string;
  /** Deprecation message of the installed version, or of the latest version when the installed one is unknown. */
  deprecated?: string;
  lastPublish?: string;
  maintainers?: number;
  weeklyDownloads?: number;
  downloadsUrl: string;
  versionExists: (version: string) => boolean;
}

interface Packument {
  "dist-tags"?: { latest?: string };
  versions?: Record<string, { deprecated?: string }>;
  time?: Record<string, string>;
  maintainers?: unknown[];
}

const REGISTRY = "https://registry.npmjs.org";

function encodeName(name: string): string {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

async function getJson<T>(url: string, attempts = 3): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return undefined;
      if (res.ok) return (await res.json()) as T;
    } catch {
      // network hiccup: retry
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return undefined;
}

/** Reads registry signals for a package. Every value is OBSERVED with `url` as its source. */
export async function npmRegistryInfo(
  name: string,
  installedVersion?: string,
): Promise<RegistryInfo | undefined> {
  const url = `${REGISTRY}/${encodeName(name)}`;
  const downloadsUrl = `https://api.npmjs.org/downloads/point/last-week/${encodeName(name)}`;
  const doc = await getJson<Packument>(url);
  if (!doc) return undefined;
  const latest = doc["dist-tags"]?.latest;
  const versions = doc.versions ?? {};
  const deprecated =
    (installedVersion ? versions[installedVersion]?.deprecated : undefined) ??
    (latest ? versions[latest]?.deprecated : undefined);
  const downloads = await getJson<{ downloads?: number }>(downloadsUrl);
  const stable = Object.keys(versions)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const [x, y] = [a, b].map((v) => v.split(".").map(Number)) as [number[], number[]];
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
    })
    .pop();
  return {
    name,
    url,
    latestVersion: latest,
    latestStable: stable,
    deprecated: deprecated || undefined,
    lastPublish: latest ? doc.time?.[latest] : doc.time?.modified,
    maintainers: Array.isArray(doc.maintainers) ? doc.maintainers.length : undefined,
    weeklyDownloads: downloads?.downloads,
    downloadsUrl,
    versionExists: (v: string) => v in versions,
  };
}
