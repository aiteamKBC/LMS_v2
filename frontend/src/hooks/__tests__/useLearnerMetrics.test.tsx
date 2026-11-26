import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { fetchLearnerMetrics, type LearnerMetrics } from '@/api/learnerMetrics';
import { useLearnerMetrics } from '../useLearnerMetrics';
import { useLearnerAttendance } from '../useLearnerAttendance';

const metrics: LearnerMetrics = {
  migrated: true,
  programme: { completed: 3, total: 4, percent: 75, status: 'ready' },
  ksb: { completed: 5, total: 8, percent: 62.5, status: 'ready' },
  otjh: { historical: 1171.34, new: 1, actual: 1172.34, planned: 867 },
};
const response = (data = metrics, status = 200) => new Response(JSON.stringify(data), { status });

describe('shared learner metric fetching', () => {
  beforeEach(() => clearAllCachedResources());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); clearAllCachedResources(); });

  it('shares the request and renders cached totals on the first frame', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const first = renderHook(() => useLearnerMetrics('commercial', '125'));
    const second = renderHook(() => useLearnerMetrics('commercial', '125'));
    await waitFor(() => expect(first.result.current.data?.otjh.actual).toBe(1172.34));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    const revisit = renderHook(() => useLearnerMetrics('commercial', '125'));
    expect(revisit.result.current.data?.programme.percent).toBe(75);
    expect(revisit.result.current.loading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not display another learner while their request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(new Promise(() => {})));
    const { result, rerender } = renderHook(({ id }) => useLearnerMetrics('commercial', id), { initialProps: { id: '125' } });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender({ id: '126' });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('recovers a failed request with refresh', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(metrics, 400)).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await waitFor(() => expect(result.current.error).not.toBe(''));
    expect(result.current.loading).toBe(false);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.otjh.actual).toBe(1172.34));
    expect(result.current.error).toBe('');
  });

  it('reads new totals after a successful activity invalidates the cache', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...metrics,
      otjh: { ...metrics.otjh, new: 2, actual: 1173.34 } }));
    vi.stubGlobal('fetch', fetch);
    await fetchLearnerMetrics('commercial', '125');
    invalidateLearnerReads();
    expect((await fetchLearnerMetrics('commercial', '125')).otjh.actual).toBe(1173.34);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not request data in demo or disabled mode', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125', false));
    expect(result.current.loading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('replaces old and new source totals after a manual refresh, including decreases', async () => {
    const changed: LearnerMetrics = { ...metrics,
      programme: { completed: 2, total: 5, percent: 40, status: 'ready' },
      ksb: { completed: 4, total: 10, percent: 40, status: 'ready' },
      otjh: { historical: 1100, new: 2, actual: 1102, planned: 900 } };
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(changed));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await waitFor(() => expect(result.current.data).toEqual(metrics));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toEqual(changed));
    expect(result.current.loading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes every mounted consumer after a save and ignores a late pre-save response', async () => {
    let finishOld!: (value: Response) => void;
    const changed = { ...metrics, otjh: { ...metrics.otjh, new: 2, actual: 1173.34 } };
    const fetch = vi.fn().mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(response(changed));
    vi.stubGlobal('fetch', fetch);
    const first = renderHook(() => useLearnerMetrics('commercial', '125'));
    const second = renderHook(() => useLearnerMetrics('commercial', '125'));
    await waitFor(() => expect(second.result.current.data).toEqual(metrics));
    act(() => first.result.current.refresh());
    expect(first.result.current.data).toEqual(metrics);
    expect(first.result.current.loading).toBe(false);
    act(() => invalidateLearnerReads());
    await waitFor(() => expect(first.result.current.data).toEqual(changed));
    await waitFor(() => expect(second.result.current.data).toEqual(changed));
    await act(async () => { finishOld(response()); });
    expect(first.result.current.data).toEqual(changed);
    expect(second.result.current.data).toEqual(changed);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not refetch on timers, focus, online, or visibility changes', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual(metrics);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cleans up save invalidation on unmount', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await waitFor(() => expect(result.current.data).toEqual(metrics));
    unmount();
    act(() => invalidateLearnerReads());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last totals after a failed refresh and recovers on the next refresh', async () => {
    const changed = { ...metrics, otjh: { ...metrics.otjh, historical: 1172.34, actual: 1173.34 } };
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(metrics, 400)).mockResolvedValueOnce(response(changed));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await waitFor(() => expect(result.current.data).toEqual(metrics));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).not.toBe(''));
    expect(result.current.data).toEqual(metrics);
    expect(result.current.loading).toBe(false);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toEqual(changed));
    expect(result.current.error).toBe('');
  });

  it('picks up new attendance and corrections after explicit refreshes', async () => {
    const attendance = { sessions: 3, present: 3, attendanceRate: 100, source: 'combined', sessionHistory: [] };
    const corrected = { ...attendance, sessions: 4, present: 2, attendanceRate: 50 };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ attendance: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attendance })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attendance: corrected })));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerAttendance('commercial', '125'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.attendanceRate).toBe(100));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.attendanceRate).toBe(50));
    expect(result.current.data?.sessions).toBe(4);
  });
});
