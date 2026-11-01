import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchModuleCatalogueActivity } from '@/api/moduleCatalogueActivity';
import { catalogueModuleActive, useCatalogueActivity } from '../useCatalogueActivity';

vi.mock('@/api/moduleCatalogueActivity', () => ({ fetchModuleCatalogueActivity: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));

describe('current module teaching, independent of publication and learner progress', () => {
  const today = '2026-11-01';
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
});
