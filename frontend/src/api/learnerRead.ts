import { createCachedResource } from './cachedRequest';

export const LEARNER_READ_TIMEOUT_MS = 45_000;
export const LEARNER_SOURCE_READ_TIMEOUT_MS = 180_000;

export class LearnerReadError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = 'LearnerReadError';
    this.status = status;
    this.code = code;
  }
}

type ReadOptions = Pick<RequestInit, 'headers' | 'credentials' | 'cache' | 'signal'> & {
  force?: boolean;
  revalidate?: boolean;
  /** Default: zero (only share in-flight reads). Opt in to 30s snapshots. */
  ttlMs?: 0 | 30_000;
};

function aborted() { return new DOMException('The operation was aborted.', 'AbortError'); }

export function withCallerSignal<T>(pending: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function fetchJson(key: string): Promise<unknown> {
  const [url, headers, credentials, cache] = JSON.parse(key) as [string, [string, string][], RequestCredentials, RequestCache];
  // Previous-learning reads can verify several original accounts and courses.
  // Keep their shared request alive while the bounded upstream reads finish.
  const timeoutMs = /^\/learner_api\/(student-activity|metrics)\//.test(url)
    ? LEARNER_SOURCE_READ_TIMEOUT_MS : LEARNER_READ_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new LearnerReadError('Loading is taking longer than expected. Please try again.', 0, 'timeout'));
      controller.abort();
    }, timeoutMs);
  });
  const load = async () => {
    let response: Response;
    try {
      response = await fetch(url, { headers: Object.fromEntries(headers), credentials, cache, signal: controller.signal });
    } catch {
      throw new LearnerReadError('Could not reach the server. Please check your connection and try again.', 0, 'network');
    }
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new LearnerReadError(`The server returned an invalid response (${response.status}).`, response.status); }
    if (!response.ok) {
      const body = data as { error?: string; detail?: string; code?: string } | null;
      throw new LearnerReadError(body?.error || body?.detail || `Request failed (${response.status}).`, response.status, body?.code);
    }
    if (data == null) throw new LearnerReadError('The server returned an empty response.', response.status);
    return data;
  };
  try { return await Promise.race([load(), deadline]); }
  finally { clearTimeout(timer!); }
}

const cached = createCachedResource('learner-json', fetchJson);
const live = createCachedResource('learner-json-live', fetchJson, 0);

/** Share a read across panels and StrictMode, while cancelling only its caller.
 * Cached responses stay in memory for 30 seconds and are keyed by the complete
 * URL and request headers, so learners, filters and staff previews stay apart. */
export function readLearnerJson<T>(url: string, options: ReadOptions = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(aborted());
  const key = readKey(url, options);
  const resource = options.ttlMs === 30_000 ? cached : live;
  return withCallerSignal(resource.read(key, { force: options.force, revalidate: options.revalidate }) as Promise<T>, options.signal);
}

function readKey(url: string, options: ReadOptions): string {
  const headers = [...new Headers(options.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([url, headers, options.credentials ?? 'include', options.cache ?? 'no-store']);
}

/** Display a recent snapshot while readLearnerJson independently refreshes it.
 * Only opt-in cached reads are eligible; live permissions/tokens never are. */
export function peekLearnerJson<T>(url: string, options: ReadOptions = {}): T | undefined {
  return cached.peek(readKey(url, options), 5 * 60_000) as T | undefined;
}

/** Drop shared JSON reads after a successful action. Callers also invalidate
 * their own detail/calendar resource when that action changes those records. */
const invalidationListeners = new Set<() => void>();

export function subscribeLearnerReadInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}

export function invalidateLearnerReads(): void {
  cached.invalidate();
  live.invalidate();
  invalidationListeners.forEach(listener => listener());
}
