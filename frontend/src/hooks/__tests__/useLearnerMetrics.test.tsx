import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { fetchLearnerMetrics, type LearnerMetrics } from '@/api/learnerMetrics';
import { useLearnerMetrics } from '../useLearnerMetrics';
import { useLearnerAttendance } from '../useLearnerAttendance';
import { LEARNER_TOTALS_REFRESH_MS } from '../useLiveLearnerRead';

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
    const fetch = vi.fn().mockResolvedValueOnce(response(metrics, 503)).mockResolvedValueOnce(response());
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

  it('replaces old and new source totals while the page stays open, including decreases', async () => {
    vi.useFakeTimers();
    const changed: LearnerMetrics = { ...metrics,
      programme: { completed: 2, total: 5, percent: 40, status: 'ready' },
      ksb: { completed: 4, total: 10, percent: 40, status: 'ready' },
      otjh: { historical: 1100, new: 2, actual: 1102, planned: 900 } };
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(changed));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual(metrics);
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNER_TOTALS_REFRESH_MS); });
    expect(result.current.data).toEqual(changed);
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
    act(() => window.dispatchEvent(new Event('focus')));
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

  it('pauses hidden polling, refreshes on return once, and cleans up on unmount', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual(metrics);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event('focus'));
      invalidateLearnerReads();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last totals during an outage and recovers in the background', async () => {
    vi.useFakeTimers();
    const changed = { ...metrics, otjh: { ...metrics.otjh, historical: 1172.34, actual: 1173.34 } };
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(metrics, 503)).mockResolvedValueOnce(response(changed));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerMetrics('commercial', '125'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual(metrics);
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNER_TOTALS_REFRESH_MS); });
    expect(result.current.data).toEqual(metrics);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).not.toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNER_TOTALS_REFRESH_MS); });
    expect(result.current.data).toEqual(changed);
    expect(result.current.error).toBe('');
  });

  it('picks up new attendance and corrections after an initially empty register', async () => {
    vi.useFakeTimers();
    const attendance = { sessions: 3, present: 3, attendanceRate: 100, source: 'combined', sessionHistory: [] };
    const corrected = { ...attendance, sessions: 4, present: 2, attendanceRate: 50 };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ attendance: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attendance })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attendance: corrected })));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLearnerAttendance('commercial', '125'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNER_TOTALS_REFRESH_MS); });
    expect(result.current.data?.attendanceRate).toBe(100);
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNER_TOTALS_REFRESH_MS); });
    expect(result.current.data?.attendanceRate).toBe(50);
    expect(result.current.data?.sessions).toBe(4);
  });
});
