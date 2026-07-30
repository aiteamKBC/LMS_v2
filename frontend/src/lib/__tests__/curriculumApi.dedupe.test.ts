import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCurriculumGetCache, createCurriculumModule, fetchCurriculumModules, fetchCurriculumStandards } from '@/lib/curriculumApi';

/**
 * Guards the two properties the curriculum request layer depends on:
 *   1. GET effect cleanups do not cancel the browser request, so DevTools stays
 *      free of StrictMode "(cancelled)" noise;
 *   2. concurrent GETs for the same path share one network request, while
 *      mutations are never coalesced.
 */

const collection = (results: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ results }),
});

describe('curriculum request layer', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not pass caller cleanup signals through to GET fetches', async () => {
    fetchMock.mockResolvedValue(collection([]));
    const controller = new AbortController();
    await fetchCurriculumStandards(controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeUndefined();
  });

  it('rejects the aborted caller without cancelling the shared GET request', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    let fetchSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      fetchSignal = init?.signal;
      return new Promise(resolve => { resolveFetch = resolve; });
    });

    const controller = new AbortController();
    const pending = fetchCurriculumStandards(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSignal).toBeUndefined();
    resolveFetch(collection([]));
  });

  it('shares one in-flight request between concurrent un-abortable GETs', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));

    const a = fetchCurriculumModules();
    const b = fetchCurriculumModules();
    const c = fetchCurriculumModules();
    resolveFetch(collection([{ id: 'm1' }]));

    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra).toEqual([{ id: 'm1' }]);
    expect(rb).toBe(ra);
    expect(rc).toBe(ra);
  });

  it('caches completed GET responses briefly across sequential calls', async () => {
    fetchMock.mockResolvedValue(collection([{ id: 'm1' }]));
    await fetchCurriculumModules();
    await expect(fetchCurriculumModules()).resolves.toEqual([{ id: 'm1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never shares full and compact module requests', async () => {
    fetchMock.mockResolvedValue(collection([]));
    await Promise.all([
      fetchCurriculumModules(undefined, { compact: false }),
      fetchCurriculumModules(undefined, { compact: true }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(urls.some(url => url.endsWith('/curriculum/modules/'))).toBe(true);
    expect(urls.some(url => url.endsWith('/curriculum/modules/?compact=true'))).toBe(true);
  });

  it('never deduplicates mutations', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ created: true }) });
    await Promise.all([
      createCurriculumModule({ name: 'A' }),
      createCurriculumModule({ name: 'A' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mock.calls.forEach(call => {
      expect((call[1] as { method?: string }).method).toBe('POST');
    });
  });

  it('clears completed GET cache before mutations', async () => {
    fetchMock
      .mockResolvedValueOnce(collection([{ id: 'm1' }]))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ created: true }) })
      .mockResolvedValueOnce(collection([{ id: 'm2' }]));

    await expect(fetchCurriculumModules()).resolves.toEqual([{ id: 'm1' }]);
    await createCurriculumModule({ name: 'A' });
    await expect(fetchCurriculumModules()).resolves.toEqual([{ id: 'm2' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not let a failed response become a shared or cached result', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchCurriculumModules()).rejects.toThrow();

    // The failed entry must be gone, so the next call actually refetches.
    fetchMock.mockResolvedValueOnce(collection([{ id: 'm1' }]));
    await expect(fetchCurriculumModules()).resolves.toEqual([{ id: 'm1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets an aborted caller leave a completed shared GET in cache', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveFetch = resolve; }));

    const controller = new AbortController();
    const aborted = fetchCurriculumModules(controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    resolveFetch(collection([{ id: 'm1' }]));
    await new Promise(resolve => setTimeout(resolve, 0));

    fetchMock.mockResolvedValueOnce(collection([{ id: 'm2' }]));
    await expect(fetchCurriculumModules()).resolves.toEqual([{ id: 'm1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('one subscriber aborting never cancels the shared request for the others', async () => {
    let resolveShared: (value: unknown) => void = () => {};
    let fetchSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      fetchSignal = init?.signal;
      return new Promise(resolve => { resolveShared = resolve; });
    });

    const first = fetchCurriculumModules();
    const second = fetchCurriculumModules();

    const controller = new AbortController();
    const joiner = fetchCurriculumModules(controller.signal);
    controller.abort();

    // One network request, and the joiner's signal never reached it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchSignal).toBeUndefined();

    resolveShared(collection([{ id: 'm3' }]));
    await expect(first).resolves.toEqual([{ id: 'm3' }]);
    await expect(second).resolves.toEqual([{ id: 'm3' }]);
    await expect(joiner).rejects.toMatchObject({ name: 'AbortError' });
  });
});
