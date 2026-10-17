import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { useDashboardTabsData } from '../useDashboardTabsData';

beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(dashboardOverviewFixture())))); });
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
describe('compact Overview request lifecycle', () => {
  it('starts only on Overview, deduplicates StrictMode and reuses a valid snapshot', async () => {
    const { result, rerender, unmount } = renderHook(({ opened }) => useDashboardTabsData('commercial', '265', true, new Set(opened)),
      { initialProps: { opened: ['weekly'] }, wrapper });
    expect(fetch).not.toHaveBeenCalled();
    rerender({ opened: ['weekly', 'overview'] });
    await waitFor(() => expect(result.current.overview.payload?.metrics.otjh.actual).toBe(12));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/learner_api/dashboard/commercial/265/overview/');
    unmount();
    const revisit = renderHook(() => useDashboardTabsData('commercial', '265', true, new Set(['overview'])), { wrapper });
    await waitFor(() => expect(revisit.result.current.overview.payload?.metrics.otjh.actual).toBe(12));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not turn cold errors into empty charts and recovers on retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable identity' }), { status: 409 }));
    const { result } = renderHook(() => useDashboardTabsData('commercial', '265', true, new Set(['overview'])));
    await waitFor(() => expect(result.current.overview.error).toBe('Unavailable identity'));
    expect(result.current.overview.payload).toBeNull();
    act(() => result.current.overview.refresh());
    await waitFor(() => expect(result.current.overview.payload?.modules).toHaveLength(1));
    expect(result.current.overview.error).toBe('');
  });
  it('replaces a pre-save response and separates learner identities', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ id }) => useDashboardTabsData('commercial', id, true, new Set(['overview'])), { initialProps: { id: '265' } });
    act(() => invalidateLearnerReads());
    await waitFor(() => expect(result.current.overview.payload?.metrics.otjh.actual).toBe(12));
    const stale = dashboardOverviewFixture(); stale.metrics.otjh.actual = 1;
    await act(async () => finish(new Response(JSON.stringify(stale))));
    expect(result.current.overview.payload?.metrics.otjh.actual).toBe(12);
    rerender({ id: '266' });
    expect(result.current.overview.payload).toBeNull();
    await waitFor(() => expect(result.current.overview.payload?.metrics.otjh.actual).toBe(12));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('does not carry a refresh into another learner valid cached snapshot', async () => {
    const { result, rerender } = renderHook(({ id }) => useDashboardTabsData('commercial', id, true, new Set(['overview'])), { initialProps: { id: '265' } });
    await waitFor(() => expect(result.current.overview.payload).not.toBeNull());
    rerender({ id: '266' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.overview.loading).toBe(false));
    act(() => result.current.overview.refresh());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    rerender({ id: '265' });
    await waitFor(() => expect(result.current.overview.payload).not.toBeNull());
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
