const cache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(url: string, attempts: number): Promise<T | undefined> {
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

/** GET a JSON document with retries; results are cached for the life of the process. */
export function getJsonCached<T>(url: string, attempts = 3): Promise<T | undefined> {
  const hit = cache.get(url);
  if (hit) return hit as Promise<T | undefined>;
  const p = fetchJson<T>(url, attempts);
  cache.set(url, p);
  return p;
}
