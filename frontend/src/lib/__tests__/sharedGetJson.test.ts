import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSharedGetJsonState, fetchSharedJsonGet } from '@/lib/sharedGetJson';

const jsonResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

describe('shared GET json helper', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearSharedGetJsonState();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not pass caller cleanup signals through to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const controller = new AbortController();

    await fetchSharedJsonGet('/api/example', { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeUndefined();
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));

    const first = fetchSharedJsonGet<{ items: string[] }>('/api/example');
    const second = fetchSharedJsonGet<{ items: string[] }>('/api/example');
    resolveFetch(jsonResponse({ items: ['a'] }));

    await expect(first).resolves.toEqual({ items: ['a'] });
    await expect(second).resolves.toEqual({ items: ['a'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects the aborted caller without cancelling the shared request', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    let fetchSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      fetchSignal = init?.signal;
      return new Promise(resolve => { resolveFetch = resolve; });
    });

    const controller = new AbortController();
    const pending = fetchSharedJsonGet('/api/example', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSignal).toBeUndefined();
    resolveFetch(jsonResponse({ ok: true }));
  });

  it('does not keep failed responses in the shared in-flight map', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchSharedJsonGet('/api/example')).rejects.toThrow('Request failed with 500');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(fetchSharedJsonGet('/api/example')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
