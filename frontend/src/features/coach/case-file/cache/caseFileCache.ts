import { createCachedResource } from '@/api/cachedRequest';
import { withCallerSignal } from '@/api/learnerRead';
import { coachFetch } from '@/lib/coachFetch';

/** Memory only. The auth lifecycle clears this registered resource on logout. */
const fetchSection = async (key: string) => {
  const [, , , url] = JSON.parse(key) as string[];
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await coachFetch(url, { signal: controller.signal });
    const payload = await response.json() as { detail?: string; error?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || payload.detail || payload.error || `Request failed (${response.status}).`);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
};
const resource = createCachedResource<unknown>('coach-case-file-session', fetchSection, Infinity, Infinity);
export const OVERVIEW_TTL_MS = 60_000;
const overview = createCachedResource<unknown>('coach-case-file-session', fetchSection, OVERVIEW_TTL_MS, Infinity);

export function readCaseFileCache<T>(scope: string, learnerId: string, section: string, url: string, options: { signal?: AbortSignal; refresh?: boolean } = {}) {
  if (options.signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  const key = JSON.stringify([scope, learnerId, section, url]);
  return withCallerSignal((section === 'overview' ? overview : resource).read(key, { revalidate: options.refresh }) as Promise<T>, options.signal);
}

export function clearCaseFileCache() { resource.invalidate(); overview.invalidate(); }

