/** Parses "1.2.3", "^1.2.3", "v1.2" into numeric parts; undefined when no version is present. */
export function parseVersion(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function majorsBehind(installed: string | undefined, latest: string | undefined): number {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  if (!a || !b) return 0;
  return Math.max(0, b[0] - a[0]);
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function safeJson<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function daysSince(iso: string | undefined, now = Date.now()): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.floor((now - t) / 86_400_000);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function tail(text: string, lines: number): string {
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

/**
 * True for pre-release versions in npm (`1.2.0-rc.1`) and Python (`1.2rc1`, `2.0a1`, `2.0b2`, `1.0.dev0`, `1.0.post1.dev2`)
 * notation. Themis never targets a pre-release.
 */
export function isPrerelease(version: string): boolean {
  return /-/.test(version) || /\d(?:\.?)(?:a|b|c|rc|alpha|beta|pre|preview|dev)\.?\d*/i.test(version);
}
