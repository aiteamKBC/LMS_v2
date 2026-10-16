import { weeklyContractFixture } from '@/test/weeklyContractFixture';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources, DEFAULT_TTL_MS } from '@/api/cachedRequest';
import { fetchLearnerDetail, invalidateLearnerDetailCache } from '@/api/learnerDetail';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { useWeeklyLearning } from '../useWeeklyLearning';

const WEEKLY = '/learner_api/dashboard/';
let served = 0;

const urls = () => vi.mocked(fetch).mock.calls.map(call => String(call[0]));
const weeklyCalls = (id?: string) => urls().filter(url => url.startsWith(WEEKLY) && (!id || url.includes(`/${id}/`))).length;

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
    return new Response(JSON.stringify(weeklyContractFixture({ id, components: [], quizAttempts: [],
      schedule: { modules: [{ id: 'M1', title: `v${served}`, curriculumSlots: [{ slotNumber: 1, date: '2026-10-13',
        type: 'live-session', sessionNumber: 1, weekId: 'W1', holidays: [] }] }], sessions: [] } })));
  }));
});

afterEach(() => {
  clearAllCachedResources();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Dashboard weekly learning read', () => {
  it('keys the browser-selected initial module and invalidates its hinted read after completion', async () => {
    const { result } = renderHook(() => useWeeklyLearning('commercial', '265', true, 'alpha'));
    await waitFor(() => expect(result.current.real?.id).toBe('265'));
    expect(urls()).toEqual(['/learner_api/dashboard/commercial/265/weekly/?moduleId=alpha']);
    act(() => invalidateLearnerDetailCache('commercial', '265'));
    await waitFor(() => expect(weeklyCalls()).toBe(2));
  });
  it('does not cache an old activity-only response as an empty schedule', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: '265', components: [] })));
    const { result } = renderHook(() => useWeeklyLearning('commercial', '265'));
    await waitFor(() => expect(result.current.loadError).toContain('incomplete'));
    expect(result.current.real).toBeNull();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.real?.id).toBe('265'));
    expect(result.current.loadError).toBeNull();
  });
  it('requests only the compact endpoint for the learner', async () => {
    const { result } = renderHook(() => useWeeklyLearning('apprenticeship', '265'));
    await waitFor(() => expect(result.current.real?.id).toBe('265'));
    expect(urls()).toEqual(['/learner_api/dashboard/apprenticeship/265/weekly/']);
  });

  it('does not refetch across focus and blur cycles while the cache is valid', async () => {
    const { result } = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(result.current.real?.schedule?.modules[0]?.title).toBe('v1'));
    for (let cycle = 0; cycle < 10; cycle += 1) {
      vi.setSystemTime(Date.now() + 1_500);
      returnToTab();
    }
    expect(weeklyCalls()).toBe(1);
  });

  it('re-reads once on return after expiry, keeping the plan on screen', async () => {
    const { result } = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(result.current.real?.schedule?.modules[0]?.title).toBe('v1'));
    vi.setSystemTime(Date.now() + DEFAULT_TTL_MS + 1);
    returnToTab();
    expect(result.current.real?.schedule?.modules[0]?.title).toBe('v1');
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.real?.schedule?.modules[0]?.title).toBe('v2'));
    expect(weeklyCalls()).toBe(2);
  });

  it('shares one request between components and reuses it on a revisit', async () => {
    const first = renderHook(() => [useWeeklyLearning('commercial', '125'), useWeeklyLearning('commercial', '125')]);
    await waitFor(() => expect(first.result.current.every(read => read.real?.schedule?.modules[0]?.title === 'v1')).toBe(true));
    first.unmount();
    const revisit = renderHook(() => useWeeklyLearning('commercial', '125'));
    expect(revisit.result.current.real?.schedule?.modules[0]?.title).toBe('v1');
    expect(revisit.result.current.loading).toBe(false);
    expect(weeklyCalls()).toBe(1);
  });

  it('refreshes after a progress save drops the learner, not after an unrelated save', async () => {
    const { result } = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(result.current.real?.schedule?.modules[0]?.title).toBe('v1'));
    act(() => invalidateLearnerReads());
    expect(weeklyCalls()).toBe(1);
    act(() => invalidateLearnerDetailCache('commercial', '125'));
    await waitFor(() => expect(result.current.real?.schedule?.modules[0]?.title).toBe('v2'));
    expect(weeklyCalls()).toBe(2);
  });

  it('picks up a completed activity or Module Builder assignment save when the Dashboard remounts', async () => {
    const dashboard = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(dashboard.result.current.real?.schedule?.modules[0]?.title).toBe('v1'));
    dashboard.unmount();
    invalidateLearnerDetailCache();
    const back = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(back.result.current.real?.schedule?.modules[0]?.title).toBe('v2'));
  });

  it('keeps the plan and retries on return after a failed refresh', async () => {
    const { result } = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(result.current.real?.schedule?.modules[0]?.title).toBe('v1'));
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loadError).toBeTruthy());
    expect(result.current.real?.schedule?.modules[0]?.title).toBe('v1');
    vi.setSystemTime(Date.now() + 1_500);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.loadError).toBeNull());
  });

  it('hides the previous learner while another learner loads', async () => {
    const { result, rerender } = renderHook(({ id }) => useWeeklyLearning('commercial', id), { initialProps: { id: '125' } });
    await waitFor(() => expect(result.current.real?.id).toBe('125'));
    rerender({ id: '132' });
    expect(result.current.real).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.real?.id).toBe('132'));
    expect(weeklyCalls('125')).toBe(1);
  });

  it('leaves the shared learner-detail cache alone', async () => {
    const detail = fetchLearnerDetail('commercial', '125');
    await detail;
    const { result } = renderHook(() => useWeeklyLearning('commercial', '125'));
    await waitFor(() => expect(result.current.real).not.toBeNull());
    await fetchLearnerDetail('commercial', '125');
    expect(urls().filter(url => url.includes('/learner-detail/'))).toHaveLength(1);
  });
});
