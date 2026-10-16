import { weeklyContractFixture } from '@/test/weeklyContractFixture';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerDetailCache } from '@/api/learnerDetail';
import { fetchWeeklyLearning, fetchWeeklyLearningWeek, invalidateWeeklyLearning, primeWeeklyLearningWeek, peekWeeklyLearningWeek, type WeeklyLearningDetail } from '@/api/weeklyLearning';
import { useWeeklyLearningWeek } from '../useWeeklyLearning';

const detail = (weekId: string, moduleId = 'M1') => ({ weekId: weekId.replace('M1', moduleId), moduleId, components: [], quizAttempts: [], videoProgress: [], componentProgress: [] });
beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'https://example.test');
  return new Response(JSON.stringify(weeklyContractFixture(detail(decodeURIComponent(url.pathname.split('/')[6]), url.searchParams.get('moduleId')!))));
})); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('selected week cache', () => {
  it('does not restore a pending old detail after activity completion invalidates it', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1', true, null));
    act(() => invalidateLearnerDetailCache('commercial', '265'));
    await waitFor(() => expect(result.current.data?.weekId).toBe('slot:M1:1'));
    const fresh = result.current.data;
    await act(async () => finish(new Response(JSON.stringify(weeklyContractFixture({ ...detail('slot:M1:1'), components: [{ componentId: 'stale' }] })))));
    expect(result.current.data).toBe(fresh);
    expect(result.current.data?.components).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('drops previously cached nondefault details when refreshing the sidebar summaries', async () => {
    await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2')).toBeDefined();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ weeks: [], selectedWeek: null })));
    await fetchWeeklyLearning('commercial', '265', { revalidate: true });
    expect(peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2')).toBeUndefined();
    await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('seeds initial week, requests one new week and immediately reuses cached weeks', async () => {
    primeWeeklyLearningWeek('commercial', '265', { ...detail('slot:M1:1'), id: '265', programme: '', cohort: '', group: '', modules: [], week: [], selectedModuleId: 'M1', selectedWeekId: 'slot:M1:1' });
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
