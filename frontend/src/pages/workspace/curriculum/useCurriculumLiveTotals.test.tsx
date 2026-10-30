import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurriculumLiveTotals, type CurriculumLiveTotals } from './useCurriculumLiveTotals';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumJson: mocks.fetch }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: (refresh: () => void) => { mocks.refresh = refresh; } }));

const totals: CurriculumLiveTotals = {
  checkedAt: '2026-10-20T10:00:00Z',
  metrics: {
    modules: { active: 12, total: 15 }, cohorts: { active: 3, total: 5 },
    groups: { active: 4, total: 8 }, sessions: { active: 6, total: 10 },
    programmes: { active: 2, total: 3 },
  },
};

beforeEach(() => { mocks.fetch.mockReset(); mocks.refresh = undefined; });

describe('Curriculum live totals', () => {
  it('uses the existing authenticated client for a fresh bounded read', async () => {
    mocks.fetch.mockResolvedValue(totals);
    const { result } = renderHook(useCurriculumLiveTotals);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(totals);
    expect(mocks.fetch).toHaveBeenCalledWith('/curriculum/live-totals/', {
      signal: expect.any(AbortSignal), skipCache: true, timeoutMs: 30000,
    });
  });

  it.each([
    { ...totals, metrics: undefined },
    { ...totals, checkedAt: 'invalid' },
    { ...totals, metrics: { ...totals.metrics, modules: { active: -1, total: 15 } } },
    { ...totals, metrics: { ...totals.metrics, modules: { active: 16, total: 15 } } },
    { ...totals, metrics: { ...totals.metrics, modules: { active: '12', total: 15 } } },
    { ...totals, metrics: { ...totals.metrics, modules: { active: 1.5, total: 15 } } },
  ])('rejects invalid totals instead of displaying misleading numbers', async invalid => {
    mocks.fetch.mockResolvedValue(invalid);
    const { result } = renderHook(useCurriculumLiveTotals);
    await waitFor(() => expect(result.current.error).toMatch(/could not be verified/));
    expect(result.current.data).toBeNull();
  });

  it('preserves genuine zeroes', async () => {
    const empty = { ...totals, metrics: Object.fromEntries(Object.keys(totals.metrics).map(key => [key, { active: 0, total: 0 }])) };
    mocks.fetch.mockResolvedValue(empty);
    const { result } = renderHook(useCurriculumLiveTotals);
    await waitFor(() => expect(result.current.data).toEqual(empty));
    expect(result.current.error).toBeNull();
  });

  it('keeps the last verified values and timestamp on refresh failure, then recovers', async () => {
    mocks.fetch.mockResolvedValueOnce(totals).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...totals, checkedAt: '2026-10-20T11:00:00Z' });
    const { result } = renderHook(useCurriculumLiveTotals);
    await waitFor(() => expect(result.current.data).toEqual(totals));
    await act(async () => { await result.current.reload(); });
    expect(result.current.data).toEqual(totals);
    expect(result.current.error).toBe('Offline');
    await act(async () => { mocks.refresh?.(); });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data?.checkedAt).toBe('2026-10-20T11:00:00Z');
  });

  it('aborts superseded requests and prevents late values overwriting the current snapshot', async () => {
    let resolve!: (value: CurriculumLiveTotals) => void;
    mocks.fetch.mockReturnValueOnce(new Promise<CurriculumLiveTotals>(done => { resolve = done; })).mockResolvedValueOnce(totals);
    const { result, unmount } = renderHook(useCurriculumLiveTotals);
    const first = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { await result.current.reload(); });
    expect(first.aborted).toBe(true);
    await act(async () => resolve({ ...totals, checkedAt: '2020-01-01T00:00:00Z' }));
    expect(result.current.data).toEqual(totals);
    const latest = mocks.fetch.mock.calls[1][1].signal as AbortSignal;
    unmount();
    expect(latest.aborted).toBe(true);
  });
});
