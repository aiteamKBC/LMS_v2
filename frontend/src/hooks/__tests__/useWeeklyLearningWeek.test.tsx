import { weeklyResourceFixture } from '@/test/weeklyContractFixture';
import { weeklyContractFixture } from '@/test/weeklyContractFixture';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerDetailCache } from '@/api/learnerDetail';
import { fetchWeeklyLearning, fetchWeeklyLearningWeek, invalidateWeeklyLearning, invalidateWeeklyProgress, prefetchWeeklyLearningWeek, primeWeeklyLearningWeek, peekWeeklyLearningWeek, type WeeklyLearningDetail } from '@/api/weeklyLearning';
import { useWeeklyLearningWeek } from '../useWeeklyLearning';

const detail = (weekId: string, moduleId = 'M1') => ({ weekId: weekId.replace('M1', moduleId), moduleId, components: [], quizAttempts: [], videoProgress: [], componentProgress: [] });
beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'https://example.test');
  return new Response(JSON.stringify(weeklyContractFixture(detail(decodeURIComponent(url.pathname.split('/')[7]), url.searchParams.get('moduleId')!))));
})); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('selected week cache', () => {
  it('prefetches only one neighbour after visible completion and reuses it on selection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let finish!: (response: Response) => void;
      vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const { result, rerender } = renderHook(({ week, next }) => useWeeklyLearningWeek('commercial', '265', 'M1', week, true, null, next),
        { initialProps: { week: 'slot:M1:2', next: 'slot:M1:3' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(true);
      await act(async () => finish(new Response(JSON.stringify(weeklyContractFixture(detail('slot:M1:2'))))));
      expect(result.current.data?.weekId).toBe('slot:M1:2');
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3')).toBeDefined();
      rerender({ week: 'slot:M1:3', next: '' });
      expect(result.current.data?.weekId).toBe('slot:M1:3');
      rerender({ week: 'slot:M1:2', next: '' });
      expect(result.current.data?.weekId).toBe('slot:M1:2');
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('does not start background work while a visible week request is active', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    await prefetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3');
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify(weeklyContractFixture(detail('slot:M1:2')))));
    await pending;
  });

  it('cancels delayed neighbour loading when the view unmounts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { unmount } = renderHook(() => useWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2', true, null, 'slot:M1:3'));
      await act(async () => { await Promise.resolve(); });
      expect(fetch).toHaveBeenCalledTimes(1);
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('an old account prefetch cannot refill the cache after account reset', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = prefetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3');
    clearAllCachedResources();
    const fresh = await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3');
    finish(new Response(JSON.stringify(weeklyContractFixture(detail('slot:M1:3')))));
    await old;
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3')).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps independent weeks cached after a known reflection while invalidating shared quiz placements', async () => {
    for (const [number, componentId, quizId] of [[1, 'C1', 7], [2, 'C2', 7], [3, 'C3', 8]] as const) {
      const data = weeklyResourceFixture(weeklyContractFixture({ ...detail(`slot:M1:${number}`),
        components: [{ componentId, type: 'quiz', isQuiz: true, quizMeta: { quizId }, contentAvailable: true }] }), '265');
      primeWeeklyLearningWeek('commercial', '265', data);
    }
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3')).toBeDefined();
    invalidateWeeklyProgress('commercial', '265', 'C1');
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1')).toBeUndefined();
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2')).toBeUndefined();
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:3')).toBeDefined();
  });
  it('an obsolete spine response cannot evict a newer week snapshot after a save', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = fetchWeeklyLearning('commercial', '265');
    invalidateLearnerDetailCache('commercial', '265');
    const fresh = await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1');
    finish(new Response(JSON.stringify({ modules: [], weeks: [], selectedWeek: null })));
    await old;
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1')).toBe(fresh);
  });

  it('account cache reset prevents an old response restoring private data', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1');
    clearAllCachedResources();
    const fresh = await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1');
    finish(new Response(JSON.stringify(weeklyContractFixture({ ...detail('slot:M1:1'), components: [{ componentId: 'private-old' }] }))));
    await old;
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1')).toBe(fresh);
    expect(fresh.selectedWeek?.activities).toEqual([]);
  });

  it('bounds externally updated attendance freshness without refetching fresh revisits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const first = await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1');
    expect(await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1')).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1');
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it('does not restore a pending old detail after activity completion invalidates it', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1', true, null));
    act(() => invalidateLearnerDetailCache('commercial', '265'));
    await waitFor(() => expect(result.current.data?.weekId).toBe('slot:M1:1'));
    const fresh = result.current.data;
    await act(async () => finish(new Response(JSON.stringify(weeklyContractFixture({ ...detail('slot:M1:1'), components: [{ componentId: 'stale' }] })))));
    expect(result.current.data).toBe(fresh);
    expect(result.current.data?.selectedWeek?.activities).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('drops previously cached nondefault details when refreshing the sidebar summaries', async () => {
    await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2')).toBeDefined();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ modules: [], weeks: [], selectedWeek: null })));
    await fetchWeeklyLearning('commercial', '265', { revalidate: true });
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2')).toBeUndefined();
    await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('seeds initial week, requests one new week and immediately reuses cached weeks', async () => {
    primeWeeklyLearningWeek('commercial', '265', weeklyResourceFixture(weeklyContractFixture(detail('slot:M1:1')), '265'));
    const { result, rerender } = renderHook(({ week }) => useWeeklyLearningWeek('commercial', '265', 'M1', week, true, null), { initialProps: { week: 'slot:M1:1' } });
    await waitFor(() => expect(result.current.data?.weekId).toBe('slot:M1:1'));
    expect(fetch).toHaveBeenCalledTimes(0);
    rerender({ week: 'slot:M1:2' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.weekId).toBe('slot:M1:2'));
    expect(fetch).toHaveBeenCalledTimes(1);
    rerender({ week: 'slot:M1:1' });
    expect(result.current.data?.weekId).toBe('slot:M1:1');
    rerender({ week: 'slot:M1:2' });
    expect(result.current.data?.weekId).toBe('slot:M1:2');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps learners and modules isolated and invalidates completed learner weeks', async () => {
    const { result, rerender } = renderHook(({ id, moduleId, revision }) => useWeeklyLearningWeek('commercial', id, moduleId, `slot:${moduleId}:1`, true, revision),
      { initialProps: { id: '265', moduleId: 'M1', revision: 0 } });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender({ id: '266', moduleId: 'M1', revision: 0 });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender({ id: '266', moduleId: 'M2', revision: 0 });
    await waitFor(() => expect(result.current.data?.moduleId).toBe('M2'));
    act(() => invalidateWeeklyLearning('commercial:266'));
    rerender({ id: '266', moduleId: 'M2', revision: 1 });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  it('ignores a slow previous selection and exposes errors for retry', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ week }) => useWeeklyLearningWeek('commercial', '265', 'M1', week, true, null), { initialProps: { week: 'slot:M1:1' } });
    rerender({ week: 'slot:M1:2' });
    await waitFor(() => expect(result.current.data?.weekId).toBe('slot:M1:2'));
    await act(async () => finish(new Response(JSON.stringify(weeklyContractFixture(detail('slot:M1:1'))))));
    expect(result.current.data?.weekId).toBe('slot:M1:2');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 }));
    rerender({ week: 'slot:M1:3' });
    await waitFor(() => expect(result.current.error).toBe('Not authorized'));
    expect(result.current.data).toBeNull();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.weekId).toBe('slot:M1:3'));
  });
});
