import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { fetchDashboardMonthly } from '@/api/dashboardMonthly';
import { dashboardMonthlyFixture } from '@/test/dashboardMonthlyFixture';
import { useDashboardMonthly } from '../useDashboardMonthly';

beforeEach(() => {
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://example.test');
    return new Response(JSON.stringify(dashboardMonthlyFixture(url.searchParams.get('month') || '2026-10')));
  }));
});
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('selected-month dashboard reads', () => {
  it('defers disabled reads, fetches only a requested month, and reuses resolved initial month', async () => {
    const { result, rerender } = renderHook(({ month, enabled }) => useDashboardMonthly('commercial', '265', month, '', enabled),
      { initialProps: { month: '', enabled: false } });
    expect(fetch).not.toHaveBeenCalled();
    rerender({ month: '', enabled: true });
    await waitFor(() => expect(result.current.data?.month).toBe('2026-10'));
    expect(fetch).toHaveBeenCalledTimes(1);
    rerender({ month: '2026-11', enabled: true });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.month).toBe('2026-11'));
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('/learner_api/dashboard/commercial/265/monthly/?month=2026-11');
    rerender({ month: '2026-10', enabled: true });
    expect(result.current.data?.month).toBe('2026-10');
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores an older selection and keeps learner, role kind and subject keys separate', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ id, month, subject, kind }) => useDashboardMonthly(kind, id, month, subject),
      { initialProps: { id: '265', month: '2026-10', subject: '', kind: 'commercial' as 'commercial' | 'apprenticeship' } });
    rerender({ id: '265', month: '2026-11', subject: '', kind: 'commercial' });
    await waitFor(() => expect(result.current.data?.month).toBe('2026-11'));
    await act(async () => finish(new Response(JSON.stringify(dashboardMonthlyFixture('2026-10')))));
    expect(result.current.data?.month).toBe('2026-11');
    rerender({ id: '266', month: '2026-11', subject: '', kind: 'commercial' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.month).toBe('2026-11'));
    rerender({ id: '266', month: '2026-11', subject: 'legacy:1', kind: 'commercial' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    rerender({ id: '266', month: '2026-11', subject: 'legacy:1', kind: 'apprenticeship' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    expect(String(vi.mocked(fetch).mock.calls[4][0])).toContain('/apprenticeship/266/monthly/?month=2026-11&subject=legacy%3A1');
  });

  it('replaces a pre-save pending read and never restores it after invalidation', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useDashboardMonthly('commercial', '265', '2026-10'));
    act(() => invalidateLearnerReads());
    await waitFor(() => expect(result.current.data?.summary.achievedHours).toBe(12));
    const stale = dashboardMonthlyFixture(); stale.summary.achievedHours = 1;
    await act(async () => finish(new Response(JSON.stringify(stale))));
    expect(result.current.data?.summary.achievedHours).toBe(12);
    const cached = await fetchDashboardMonthly('commercial', '265', '2026-10');
    expect(cached.summary.achievedHours).toBe(12);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes after booking, clears other learner-month snapshots, and then permits cached returns', async () => {
    const { result, rerender } = renderHook(({ month }) => useDashboardMonthly('commercial', '265', month), { initialProps: { month: '2026-10' } });
    await waitFor(() => expect(result.current.data?.month).toBe('2026-10'));
    rerender({ month: '2026-11' });
    await waitFor(() => expect(result.current.data?.month).toBe('2026-11'));
    act(() => result.current.refresh());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    rerender({ month: '2026-10' });
    await waitFor(() => expect(result.current.data?.month).toBe('2026-10'));
    expect(fetch).toHaveBeenCalledTimes(4);
    rerender({ month: '2026-11' });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('preserves the last successful month on refresh error and retries without fabricating hours', async () => {
    const { result } = renderHook(() => useDashboardMonthly('commercial', '265', '2026-10'));
    await waitFor(() => expect(result.current.data?.month).toBe('2026-10'));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe('Not authorized'));
    expect(result.current.data?.summary.achievedHours).toBe(12);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe(''));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects an incomplete summary or the wrong selected month', async () => {
    const wrong = dashboardMonthlyFixture('2026-09');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(wrong)));
    await expect(fetchDashboardMonthly('commercial', '265', '2026-10')).rejects.toThrow('Could not load');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...dashboardMonthlyFixture(), summary: { ksbs: [] } })));
    await expect(fetchDashboardMonthly('commercial', '265', '2026-10')).rejects.toThrow('Could not load');
  });
});
