import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const mocks = vi.hoisted(() => ({
  weekRead: vi.fn(),
  scheduleRead: vi.fn(),
  contract: vi.fn(),
  monthlyLogs: vi.fn(),
  subjectRequest: vi.fn(),
  learnerRead: vi.fn(),
}));

vi.mock('@/api/learnerOverview', () => ({
  overviewWeek: { read: mocks.weekRead, peek: () => undefined },
  overviewSchedule: { read: mocks.scheduleRead, peek: () => undefined },
}));
vi.mock('@/api/trainingPlanDashboard', () => ({
  fetchTrainingPlanContract: mocks.contract,
}));
vi.mock('@/features/monthly-logs/api', () => ({
  getLogSummary: mocks.monthlyLogs,
}));
vi.mock('@/api/studentActivity', () => ({
  subjectRequest: mocks.subjectRequest,
}));
vi.mock('@/api/learnerRead', () => ({
  readLearnerJson: mocks.learnerRead,
  subscribeLearnerReadInvalidation: () => () => undefined,
}));

import { useDashboardPlan } from '@/pages/workspace/learner/useDashboardPlan';
import { useMonthlyAssignmentPlan } from '@/pages/learner/monthly-submission/useMonthlyAssignmentPlan';
import { useCaseFileDashboardPlan } from './useCaseFileDashboardPlan';

describe('Learner Case File tab request characterization', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    mocks.weekRead.mockImplementation(async () => {
      calls.push('overview-week');
      return { weekStart: '2026-09-21', weekEnd: '2026-09-27', modules: [], deadlines: [], otjh: {}, planSubjects: [] };
    });
    mocks.scheduleRead.mockImplementation(async () => {
      calls.push('training-plan:overview');
      return { sessions: [], reviews: [], modules: [], moduleLinks: {} };
    });
    mocks.contract.mockImplementation(async () => {
      calls.push('training-plan:contract');
      return { months: {}, contractStatus: 'ready' };
    });
    mocks.monthlyLogs.mockImplementation(async () => {
      calls.push('monthly-logs');
      return { learner: { aptem_id: null }, months: [] };
    });
    mocks.subjectRequest.mockImplementation(async () => {
      calls.push('subject-covers');
      return { subjects: [] };
    });
    mocks.learnerRead.mockImplementation(async () => {
      calls.push('reflection-statuses');
      return { statuses: [] };
    });
  });

  it('starts all four dashboard-plan dependencies while the page-level plan hook is enabled', async () => {
    const { result } = renderHook(() => useDashboardPlan('apprenticeship', '5170', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toEqual([
      'overview-week',
      'training-plan:overview',
      'training-plan:contract',
      'monthly-logs',
    ]);
  });

  it('does not start dashboard-plan dependencies until a plan tab requests them', async () => {
    const { result } = renderHook(() => useCaseFileDashboardPlan('apprenticeship', '5170', true, false));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toEqual([]);
  });

  it('loads once on first plan-tab visit and reuses the page-lifetime result across tab switches', async () => {
    const { result, rerender } = renderHook(
      ({ requested }) => useCaseFileDashboardPlan('apprenticeship', '5170', true, requested),
      { initialProps: { requested: false } },
    );
    rerender({ requested: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ requested: false });
    rerender({ requested: true });

    expect(calls).toEqual([
      'overview-week', 'training-plan:overview', 'training-plan:contract', 'monthly-logs',
    ]);
  });

  it('keeps a failed plan isolated and allows the existing retry action to refetch', async () => {
    mocks.weekRead.mockRejectedValueOnce(new Error('Plan unavailable'));
    const { result } = renderHook(() => useCaseFileDashboardPlan('apprenticeship', '5170', true, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain('Plan unavailable');

    await act(async () => result.current.refresh());
    await waitFor(() => {
      expect(mocks.weekRead).toHaveBeenCalledTimes(2);
      expect(mocks.scheduleRead).toHaveBeenCalledTimes(2);
      expect(mocks.contract).toHaveBeenCalledTimes(2);
      expect(mocks.monthlyLogs).toHaveBeenCalledTimes(2);
    });
  });

  it('records the three assignment-plan dependencies and repeats them after a tab remount', async () => {
    const first = renderHook(() => useMonthlyAssignmentPlan('apprenticeship', '5170'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useMonthlyAssignmentPlan('apprenticeship', '5170'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(calls).toEqual([
      'subject-covers', 'training-plan:contract', 'reflection-statuses',
      'subject-covers', 'training-plan:contract', 'reflection-statuses',
    ]);
  });

  it.skip('future boundary: returning to Assignments should reuse its successful tab cache', () => {});
});
