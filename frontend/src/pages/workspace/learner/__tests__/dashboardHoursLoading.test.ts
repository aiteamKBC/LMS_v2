import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboardPlan } from '../useDashboardPlan';
import type { LogSummary } from '@/features/monthly-logs/api';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), contract: vi.fn() }));
vi.mock('@/features/monthly-logs/api', () => ({ getLogSummary: mocks.summary }));
vi.mock('@/api/trainingPlanDashboard', () => ({ fetchTrainingPlanContract: mocks.contract }));
vi.mock('@/hooks/useLiveLearnerRead', () => ({ useLiveLearnerRead: () => ({ data: null, loading: false, error: '', refresh: vi.fn() }) }));
vi.mock('@/api/learnerOverview', () => ({ overviewWeek: {}, overviewSchedule: {} }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const summary = { learner: { aptem_id: 42 }, months: [{ month: '2026-09', actual_hours: 12, not_accepted_hours: 3 }] } as LogSummary;

describe('dashboard hours request lifecycle', () => {
  it('accepts the shared Monthly Logs response after 30 seconds', async () => {
    vi.useFakeTimers();
    mocks.contract.mockResolvedValue({ months: {}, contractStatus: 'unavailable' });
    let resolve!: (value: LogSummary) => void;
    mocks.summary.mockReturnValue(new Promise<LogSummary>(done => { resolve = done; }));
    const { result } = renderHook(() => useDashboardPlan('commercial', '125'));
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(mocks.summary.mock.calls[0][1].aborted).toBe(false);
    await act(async () => { resolve(summary); });
    expect(result.current.otjh.actual).toBe(12);
    expect(result.current.otjh.actualLoading).toBe(false);
  });

  it('keeps the server failure reason visible without inventing hours', async () => {
    mocks.contract.mockResolvedValue({ months: {}, contractStatus: 'unavailable' });
    mocks.summary.mockRejectedValue(new Error('Programme dates need review.'));
    const { result } = renderHook(() => useDashboardPlan('commercial', '125'));
    await act(async () => {});
    expect(result.current.error).toBe('Programme dates need review.');
    expect(result.current.otjh.actual).toBeNull();
    expect(result.current.otjh.actualLoading).toBe(false);
  });
});
