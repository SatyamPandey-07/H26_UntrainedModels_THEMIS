import type { RegistryInfo } from "../../tools/registry.js";
import { getJsonCached } from "./http.js";

interface PyPiFile {
  upload_time_iso_8601?: string;
  upload_time?: string;
  yanked?: boolean;
  yanked_reason?: string | null;
}

export interface PyPiDoc {
  info: {
    name?: string;
    version?: string;
    author?: string | null;
    maintainer?: string | null;
    requires_dist?: string[] | null;
    classifiers?: string[];
    yanked?: boolean;
    yanked_reason?: string | null;
  };
  releases?: Record<string, PyPiFile[]>;
  urls?: Array<PyPiFile & { filename?: string; digests?: { sha256?: string } }>;
}

export const PYPI = "https://pypi.org";

export function pypiProjectUrl(name: string): string {
  return `${PYPI}/project/${encodeURIComponent(name)}/`;
}

/** Project JSON, or the JSON of one release when `version` is given. */
export function pypiDoc(name: string, version?: string): Promise<PyPiDoc | undefined> {
  const path = version
    ? `${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`
    : `${encodeURIComponent(name)}/json`;
  return getJsonCached<PyPiDoc>(`${PYPI}/pypi/${path}`);
}

function countPeople(...fields: Array<string | null | undefined>): number | undefined {
  const names = new Set<string>();
  for (const f of fields)
    for (const part of (f ?? "").split(/[,;]|\sand\s/)) if (part.trim()) names.add(part.trim().toLowerCase());
  return names.size > 0 ? names.size : undefined;
}

const allYanked = (files: PyPiFile[] | undefined) =>
  Boolean(files && files.length > 0 && files.every((f) => f.yanked));

/** Reads PyPI signals for a distribution. Every value is OBSERVED with the PyPI URL as its source. */
export async function pypiRegistryInfo(
  name: string,
  installedVersion?: string,
): Promise<RegistryInfo | undefined> {
  const doc = await pypiDoc(name);
  if (!doc?.info) return undefined;
  const latest = doc.info.version;
  const releases = doc.releases ?? {};
  const installedFiles = installedVersion ? releases[installedVersion] : undefined;
  const latestFiles = latest ? (releases[latest] ?? doc.urls) : undefined;

  let deprecated: string | undefined;
  if (allYanked(installedFiles))
    deprecated = installedFiles?.[0]?.yanked_reason || `release ${installedVersion} was yanked`;
  else if (allYanked(latestFiles))
    deprecated = latestFiles?.[0]?.yanked_reason || `release ${latest} was yanked`;
  else if ((doc.info.classifiers ?? []).some((c) => c.startsWith("Development Status :: 7")))
    deprecated = "project is classified Development Status :: 7 - Inactive";

  const times = (latestFiles ?? [])
    .map((f) => f.upload_time_iso_8601 ?? (f.upload_time ? `${f.upload_time}Z` : undefined))
    .filter((t): t is string => Boolean(t))
    .sort();
  const downloadsUrl = `https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`;
  const downloads = await getJsonCached<{ data?: { last_week?: number } }>(downloadsUrl, 2);

  return {
    name,
    url: pypiProjectUrl(name),
    latestVersion: latest,
    deprecated,
    lastPublish: times[times.length - 1],
    maintainers: countPeople(doc.info.author, doc.info.maintainer),
    weeklyDownloads: downloads?.data?.last_week,
    downloadsUrl,
    versionExists: (v: string) => (Object.keys(releases).length > 0 ? v in releases : v === latest),
  };
}

/** sha256 digests of every file of a release, for rewriting `--hash` requirements. */
export async function releaseHashes(name: string, version: string): Promise<string[]> {
  const doc = await pypiDoc(name, version);
  return (doc?.urls ?? []).map((u) => u.digests?.sha256).filter((h): h is string => Boolean(h));
}

/** Names this release depends on unconditionally (no extras, markers ignored), PEP 503 normalised. */
export function requiresDist(doc: PyPiDoc | undefined): string[] {
  const out = new Set<string>();
  for (const spec of doc?.info.requires_dist ?? []) {
    if (/;.*\bextra\b/.test(spec)) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec);
    if (m) out.add(m[1]!.toLowerCase().replace(/[-_.]+/g, "-"));
  }
  return [...out];
}
