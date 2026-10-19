import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchLearnerDetail, invalidateLearnerDetailCache } from '../learnerDetail';
import { loadRecordingWatch, loadSessionResult, recordRecordingWatch, type SessionFile } from '../sessionResults';

beforeEach(() => clearAllCachedResources());
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

it.each(['commercial', 'apprenticeship'] as const)('loads one selected activity without a summary/catalogue/legacy probe (%s)', async kind => {
  const fetcher = vi.fn(async () => Response.json({ id: '7', components: [{ componentId: 'LIVE' }] }));
  vi.stubGlobal('fetch', fetcher);
  await Promise.all([fetchLearnerDetail(kind, '7', { componentId: 'LIVE' }), fetchLearnerDetail(kind, '7', { componentId: 'LIVE' })]);
  await fetchLearnerDetail(kind, '7', { componentId: 'LIVE' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(`/learner_api/learner-detail/${kind}/7/?content=activity&component_id=LIVE`, expect.any(Object));
  invalidateLearnerDetailCache(kind, '7');
  await fetchLearnerDetail(kind, '7', { componentId: 'LIVE' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects mismatched activity identity rather than using a stale component', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '8', components: [{ componentId: 'OTHER' }] })));
  await expect(fetchLearnerDetail('commercial', '7', { componentId: 'LIVE' })).rejects.toThrow('different activity');
});

it('shares session results despite caller cancellation, keeping learner scopes separate', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const abort = new AbortController();
  const old = loadSessionResult('S1', 1, { kind: 'commercial', id: '7' }, abort.signal);
  abort.abort();
  const current = loadSessionResult('S1', 1, { kind: 'commercial', id: '7' });
  await expect(old).rejects.toHaveProperty('name', 'AbortError');
  finish(Response.json({ sessions: [] }));
  await current;
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => Response.json({ sessions: [] }));
  await loadSessionResult('S1', 1, { kind: 'apprenticeship', id: '8' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('shares concurrent watch reads but rechecks saved watch state on later mounts', async () => {
  const fetcher = vi.fn(async () => Response.json({ watchedSeconds: 30, durationSeconds: 60, csrfToken: 'synthetic' }));
  vi.stubGlobal('fetch', fetcher);
  const file = { id: 'F1' } as SessionFile;
  const learner = { kind: 'commercial' as const, id: '7' };
  await Promise.all([loadRecordingWatch('S1', file, learner), loadRecordingWatch('S1', file, learner)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await loadRecordingWatch('S1', file, learner);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not join a pre-save watch read after a successful watch report', async () => {
  let finishOld!: (response: Response) => void;
  let gets = 0;
  const fetcher = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'POST' || gets++ > 0) return Promise.resolve(Response.json({ watchedSeconds: 90, durationSeconds: 120 }));
    return new Promise<Response>(resolve => { finishOld = resolve; });
  });
  vi.stubGlobal('fetch', fetcher);
  const file = { id: 'F1' } as SessionFile;
  const learner = { kind: 'commercial' as const, id: '7' };
  const old = loadRecordingWatch('S1', file, learner);
  await recordRecordingWatch('S1', file, learner, { watchedSeconds: 30, position: 90, duration: 120 }, 'synthetic');
  expect(await loadRecordingWatch('S1', file, learner)).toHaveProperty('watchedSeconds', 90);
  expect(fetcher).toHaveBeenCalledTimes(3);
  finishOld(Response.json({ watchedSeconds: 60, durationSeconds: 120 }));
  await old;
});
