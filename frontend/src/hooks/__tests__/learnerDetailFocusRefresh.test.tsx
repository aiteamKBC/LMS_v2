import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources, DEFAULT_TTL_MS } from '@/api/cachedRequest';
import { invalidateLearnerDetailCache } from '@/api/learnerDetail';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { useLearnerDetailParam } from '../useLearnerDetailParam';

const DETAIL = '/learner_api/learner-detail/';
let served = 0;

function detailCalls(id?: string) {
  return vi.mocked(fetch).mock.calls.map(call => String(call[0]))
    .filter(url => url.startsWith(DETAIL) && (!id || url.includes(`/${id}/`))).length;
}

function returnToTab() {
  act(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  clearAllCachedResources();
  served = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const id = String(input).split('/')[4];
    served += 1;
    return new Response(JSON.stringify({ id, name: `Learner ${id} v${served}`, components: [] }));
  }));
});

afterEach(() => {
  clearAllCachedResources();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Dashboard mode: focus reuses a valid cache entry; saves and expiry still refresh. */
describe('learner detail refresh on return (expired mode)', () => {
  it('does not refetch across repeated focus and blur cycles while the cache is valid', async () => {
    const { result } = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v1'));
    for (let cycle = 0; cycle < 10; cycle += 1) {
      vi.setSystemTime(Date.now() + 1_500);
      returnToTab();
    }
    expect(detailCalls()).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('re-reads on return once the cache entry has expired, keeping the learner visible', async () => {
    const { result } = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v1'));
    vi.setSystemTime(Date.now() + DEFAULT_TTL_MS + 1);
    returnToTab();
    expect(result.current.real?.name).toBe('Learner 125 v1');
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v2'));
    expect(detailCalls()).toBe(2);
  });

  it('reuses the cache when the Dashboard is revisited, and two components share one request', async () => {
    const first = renderHook(() => [
      useLearnerDetailParam('commercial', '125', 'expired'),
      useLearnerDetailParam('commercial', '125'),
    ]);
    await waitFor(() => expect(first.result.current.every(read => read.real?.name === 'Learner 125 v1')).toBe(true));
    first.unmount();
    const revisit = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    expect(revisit.result.current.real?.name).toBe('Learner 125 v1');
    expect(revisit.result.current.loading).toBe(false);
    vi.setSystemTime(Date.now() + DEFAULT_TTL_MS + 1);
    const both = renderHook(() => [
      useLearnerDetailParam('commercial', '125', 'expired'),
      useLearnerDetailParam('commercial', '125', 'expired'),
    ]);
    returnToTab();
    await waitFor(() => expect(both.result.current.every(read => read.real?.name === 'Learner 125 v2')).toBe(true));
    expect(detailCalls()).toBe(2);
  });

  it('refreshes after a save drops the learner entry, but not after an unrelated save', async () => {
    const { result } = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v1'));
    act(() => invalidateLearnerReads());
    expect(detailCalls()).toBe(1);
    act(() => invalidateLearnerDetailCache('commercial', '125'));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v2'));
    expect(detailCalls()).toBe(2);
  });

  it('picks up a completed activity when the Dashboard remounts after the save', async () => {
    const dashboard = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    await waitFor(() => expect(dashboard.result.current.real?.name).toBe('Learner 125 v1'));
    dashboard.unmount();
    invalidateLearnerDetailCache('commercial', '125');
    const back = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    await waitFor(() => expect(back.result.current.real?.name).toBe('Learner 125 v2'));
  });

  it('retries on return after a failed refresh even though the old entry is still valid', async () => {
    const { result } = renderHook(() => useLearnerDetailParam('commercial', '125', 'expired'));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v1'));
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loadError).toBeTruthy());
    expect(result.current.real?.name).toBe('Learner 125 v1');
    vi.setSystemTime(Date.now() + 1_500);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.loadError).toBeNull());
  });

  it('switches learner identity without showing or refreshing the previous learner', async () => {
    const { result, rerender } = renderHook(({ id }) => useLearnerDetailParam('commercial', id, 'expired'), { initialProps: { id: '125' } });
    await waitFor(() => expect(result.current.real?.id).toBe('125'));
    rerender({ id: '132' });
    expect(result.current.real).toBeNull();
    await waitFor(() => expect(result.current.real?.id).toBe('132'));
    vi.setSystemTime(Date.now() + 1_500);
    returnToTab();
    expect(detailCalls('125')).toBe(1);
    expect(detailCalls('132')).toBe(1);
  });

  it('leaves the default always-refresh mode unchanged for other consumers', async () => {
    const { result } = renderHook(() => useLearnerDetailParam('commercial', '125', true));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v1'));
    returnToTab();
    await waitFor(() => expect(result.current.real?.name).toBe('Learner 125 v2'));
    expect(detailCalls()).toBe(2);
  });
});
