import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModuleCatalogueActivity } from '@/api/moduleCatalogueActivity';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { catalogueModuleActive, useCatalogueActivity } from '../useCatalogueActivity';

vi.mock('@/api/moduleCatalogueActivity', () => ({ fetchModuleCatalogueActivity: vi.fn() }));

describe('current module teaching, independent of publication and learner progress', () => {
  beforeEach(() => { clearAllCachedResources(); vi.mocked(fetchModuleCatalogueActivity).mockReset(); });
  const today = '2026-11-01';
  it('lets Delivery revalidate on return from an edit while preserving the catalogue default cache', async () => {
    vi.mocked(fetchModuleCatalogueActivity).mockResolvedValue({ A: { source: 'new_lms', startDate: '2026-10-01', lastLiveDate: '2026-12-01' } });
    const first = renderHook(() => useCatalogueActivity('delivery-dashboard', 'staff-1'));
    await waitFor(() => expect(first.result.current.data?.A).toBeDefined()); first.unmount();
    const cached = renderHook(() => useCatalogueActivity('delivery-dashboard', 'staff-1'));
    await waitFor(() => expect(cached.result.current.loading).toBe(false)); cached.unmount();
    expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(1);
    vi.mocked(fetchModuleCatalogueActivity).mockResolvedValue({});
    const refreshed = renderHook(() => useCatalogueActivity('delivery-dashboard', 'staff-1', { revalidateOnMount: true }));
    await waitFor(() => expect(refreshed.result.current.data).toEqual({}));
    expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(2); refreshed.unmount();
  });
  it('requires a known start and a live teaching date that has not passed', () => {
    expect(catalogueModuleActive(undefined, today)).toBe(false);
    expect(catalogueModuleActive({ source: 'old_lms', startDate: '', lastLiveDate: '2026-11-05' }, today)).toBe(false);
    expect(catalogueModuleActive({ source: 'new_lms', startDate: '2026-10-01', lastLiveDate: '' }, today)).toBe(false);
    expect(catalogueModuleActive({ source: 'new_lms', startDate: '2026-12-01', lastLiveDate: '2026-12-31' }, today)).toBe(false);
    expect(catalogueModuleActive({ source: 'new_lms', startDate: '2026-09-01', lastLiveDate: '2026-10-31' }, today)).toBe(false);
  });
  it.each(['new_lms', 'old_lms'] as const)('keeps %s active through its final postponed teaching day', source => {
    const activity = { source, startDate: '2026-09-01', lastLiveDate: '2026-11-01' };
    expect(catalogueModuleActive(activity, today)).toBe(true);
    expect(catalogueModuleActive(activity, '2026-11-02')).toBe(false);
  });

  it('does not let End date alone keep a module active, and allows teaching postponed past it', () => {
    const endedTeaching = { source: 'new_lms' as const, startDate: '2026-09-01', endDate: '2026-11-30', lastLiveDate: '2026-10-31' };
    expect(catalogueModuleActive(endedTeaching, today)).toBe(false);
    const postponedTeaching = { ...endedTeaching, endDate: '2026-10-31', lastLiveDate: '2026-11-08' };
    expect(catalogueModuleActive(postponedTeaching, today)).toBe(true);
  });

  it('updates the business day in an open tab without reloading the whole catalogue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T23:59:30Z'));
    vi.mocked(fetchModuleCatalogueActivity).mockReset().mockResolvedValue({
      A: { source: 'new_lms', startDate: '2026-10-01', lastLiveDate: '2026-11-01' },
    });
    const { result, unmount } = renderHook(() => useCatalogueActivity('A'));
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(catalogueModuleActive(result.current.data?.A, result.current.today)).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(result.current.today).toBe('2026-11-02');
      expect(catalogueModuleActive(result.current.data?.A, result.current.today)).toBe(false);
      expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(1);
    } finally { unmount(); vi.useRealTimers(); }
  });

  it('discards a stale request when the displayed catalogue changes', async () => {
    let release!: (value: Awaited<ReturnType<typeof fetchModuleCatalogueActivity>>) => void;
    vi.mocked(fetchModuleCatalogueActivity).mockReset()
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce({ B: { source: 'old_lms', startDate: '2026-10-01', lastLiveDate: '2026-12-01' } });
    const { result, rerender } = renderHook(({ key }) => useCatalogueActivity(key), { initialProps: { key: 'A' } });
    rerender({ key: 'B' });
    await waitFor(() => expect(result.current.data?.B?.source).toBe('old_lms'));
    await act(async () => { release({ A: { source: 'new_lms', startDate: '2000-01-01', lastLiveDate: '2099-12-31' } }); });
    expect(result.current.data?.A).toBeUndefined();
    expect(result.current.data?.B?.source).toBe('old_lms');
  });

  it('shares a pending read, renders a warm remount immediately, and makes no focus-burst requests', async () => {
    let release!: (value: Awaited<ReturnType<typeof fetchModuleCatalogueActivity>>) => void;
    vi.mocked(fetchModuleCatalogueActivity).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = renderHook(() => useCatalogueActivity('A', 'staff-1'));
    const second = renderHook(() => useCatalogueActivity('A', 'staff-1'));
    expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(1);
    first.unmount();
    const data = { A: { source: 'new_lms' as const, startDate: '2026-10-01', lastLiveDate: '2026-12-01' } };
    await act(async () => { release(data); });
    expect(second.result.current.data).toEqual(data);
    second.unmount();
    const warm = renderHook(() => useCatalogueActivity('A', 'staff-1'));
    expect(warm.result.current.data).toEqual(data);
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(1);
    warm.unmount();
  });

  it('refreshes stale data on return and lets Retry bypass the fresh cache', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchModuleCatalogueActivity).mockResolvedValue({ A: { source: 'new_lms', startDate: '2026-10-01', lastLiveDate: '2026-12-01' } });
    const { result, unmount } = renderHook(() => useCatalogueActivity('A', 'staff-1'));
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { result.current.reload(); });
      expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
      expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(2); // no network polling
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(3);
    } finally { unmount(); vi.useRealTimers(); }
  });

  it('never reuses another account snapshot and drops cached data on sign-out invalidation', async () => {
    vi.mocked(fetchModuleCatalogueActivity)
      .mockResolvedValueOnce({ A: { source: 'old_lms', startDate: '2026-10-01', lastLiveDate: '2026-12-01' } })
      .mockResolvedValue({});
    const { result, rerender, unmount } = renderHook(({ account }) => useCatalogueActivity('A', account), { initialProps: { account: 'staff-1' } });
    await waitFor(() => expect(result.current.data?.A).toBeDefined());
    rerender({ account: 'staff-2' });
    expect(result.current.data?.A).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({}));
    unmount();
    clearAllCachedResources();
    const nextSession = renderHook(() => useCatalogueActivity('A', 'staff-1'));
    await waitFor(() => expect(nextSession.result.current.data).toEqual({}));
    expect(fetchModuleCatalogueActivity).toHaveBeenCalledTimes(3);
    nextSession.unmount();
  });
});
