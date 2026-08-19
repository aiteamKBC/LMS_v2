// ============================================================================
// Shared read-through cache for GET endpoints.
//
// Generalised from the pattern already proven in learnerDetail.ts: a short TTL
// cache plus an in-flight map, so the same payload is fetched once no matter
// how many components ask for it.
//
// It solves two distinct duplications:
//   * React StrictMode double-mounts every effect in dev, so a single page load
//     fired each request twice — visible as duplicate rows, one of them left
//     "(pending)" when the first render is torn down.
//   * Moving between wizard steps and learner pages re-mounted components that
//     needed a payload already in memory, re-requesting it every time.
//
// In memory only, never sessionStorage: these payloads carry learner PII, and a
// tab that is closed should not leave it behind on disk.
// ============================================================================

interface Entry<T> {
  data: T;
  expiresAt: number;
}

/** Long enough to cover a page's mount storm and normal back-and-forth. */
export const DEFAULT_TTL_MS = 30_000;

const caches = new Map<string, Map<string, Entry<unknown>>>();
const inFlight = new Map<string, Map<string, Promise<unknown>>>();

function bucket<V>(store: Map<string, Map<string, V>>, name: string): Map<string, V> {
  let found = store.get(name);
  if (!found) {
    found = new Map<string, V>();
    store.set(name, found);
  }
  return found;
}

/**
 * A named group of cached GETs — one per resource, so invalidating "the board"
 * cannot accidentally drop unrelated entries.
 *
 * `fetcher` is the existing API function, untouched: this wraps call sites
 * rather than replacing the request layer, so an endpoint's error handling and
 * response shape stay exactly where they already are.
 */
export function createCachedResource<T>(
  name: string,
  fetcher: (key: string) => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
) {
  const read = (key: string, options: { force?: boolean } = {}): Promise<T> => {
    const cache = bucket<Entry<unknown>>(caches, name);
    const pending = bucket<Promise<unknown>>(inFlight, name);

    if (!options.force) {
      const hit = cache.get(key) as Entry<T> | undefined;
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);
      // An identical request is already on the wire — join it rather than
      // opening a second one. This is what collapses the StrictMode pair.
      const existing = pending.get(key) as Promise<T> | undefined;
      if (existing) return existing;
    }

    const promise = fetcher(key)
      .then((data) => {
        cache.set(key, { data, expiresAt: Date.now() + ttlMs });
        return data;
      })
      // A failure is never cached: the next mount retries rather than being
      // stuck with an error for the rest of the TTL.
      .finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });

    pending.set(key, promise);
    return promise;
  };

  /**
   * The cached value right now, or undefined if there isn't a live one.
   *
   * Synchronous by design, for the one thing `read` cannot do: render cached data
   * on a component's *first* frame. Effects run after paint, so a component that
   * starts in a loading state always flashes its spinner once — even when the
   * payload was already in memory and the promise resolves in a microtask. That
   * flash is what made revisiting a wizard step look like a page load.
   *
   * Never a substitute for `read`: a miss returns undefined and the caller must
   * still fetch. Expiry is honoured, so this cannot serve a stale entry that
   * `read` would have refreshed.
   */
  const peek = (key: string): T | undefined => {
    const hit = bucket<Entry<unknown>>(caches, name).get(key) as Entry<T> | undefined;
    return hit && hit.expiresAt > Date.now() ? hit.data : undefined;
  };

  /** Drop one key (or the whole resource) after a write that changes it. */
  const invalidate = (key?: string): void => {
    const cache = bucket<Entry<unknown>>(caches, name);
    if (key === undefined) cache.clear();
    else cache.delete(key);
  };

  /**
   * Store a payload a write already returned, so a save doesn't cost a refetch.
   * Only call this with a full server response — seeding a locally-assembled
   * object would serve something the server never sent.
   */
  const prime = (key: string, data: T): void => {
    bucket<Entry<unknown>>(caches, name).set(key, { data, expiresAt: Date.now() + ttlMs });
  };

  return { read, peek, invalidate, prime };
}

/** Test seam — drops every cached resource. */
export function clearAllCachedResources(): void {
  caches.clear();
  inFlight.clear();
}
