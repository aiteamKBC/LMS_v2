import { describe, expect, it } from 'vitest';
import type { LogSummary } from '@/features/monthly-logs/api';
import { contractPlannedOtjh, monthlyLogActualOtjh, monthlyLogOtjh } from '../useDashboardPlan';

describe('dashboard OTJH source transition', () => {
  it('maps retained Audit values and LMS months into the chart payload', () => {
    const summary = {
      learner: { id: 125, aptem_id: 7001, name: 'Learner', programme: 'Programme', coach_name: '' },
      months: [
        { month: '2025-04', source: 'legacy', training_plan_target: '44.00', actual_hours: '61.021944', not_accepted_hours: '2.5' },
        { month: '2026-09', source: 'lms', training_plan_target: 40, actual_hours: 12, not_accepted_hours: 3 },
      ],
    } as unknown as LogSummary;

    expect(monthlyLogOtjh(summary)).toEqual({
      cutoffMonth: '2026-08',
      months: {
        '2025-04': { target: 44, submitted: 2.5, completed: 61.021944 },
        '2026-09': { target: 40, submitted: 3, completed: 12 },
      },
    });
  });

  it('leaves learners without an Audit record entirely on LMS calculations', () => {
    const summary = {
      learner: { id: 125, aptem_id: null, name: 'Learner', programme: 'Programme', coach_name: '' },
      months: [{ month: '2026-09', source: 'lms', training_plan_target: 40, actual_hours: 12, not_accepted_hours: 3 }],
    } as unknown as LogSummary;

    expect(monthlyLogOtjh(summary)).toEqual({
      months: { '2026-09': { target: 40, submitted: 3, completed: 12 } },
      cutoffMonth: undefined,
    });
  });

  it('sums accepted log months once, including months after the Audit cutoff', () => {
    expect(monthlyLogActualOtjh({
      '2026-08': { completed: 18 },
      '2026-09': { completed: 2.5 },
      '2026-10': { completed: 1.25 },
    })).toBe(21.75);
    expect(monthlyLogActualOtjh(undefined)).toBeNull();
    expect(monthlyLogActualOtjh({})).toBe(0);
  });

  it('uses all parsed PDF months and preserves a genuine zero target', () => {
    const month = { label: '', topics: [], source: 'contract', planned: 0 };
    expect(contractPlannedOtjh({ contractStatus: 'ready', months: {
      '2026-08': { ...month, planned: 32 }, '2026-09': { ...month, planned: 37 },
      '2027-01': { ...month, planned: 35 },
    } })).toBe(104);
    expect(contractPlannedOtjh({ contractStatus: 'ready', months: { '2026-08': month } })).toBe(0);
    expect(contractPlannedOtjh({ contractStatus: 'ready', months: { '2026-08': { ...month, planned: null } } })).toBeNull();
    expect(contractPlannedOtjh({ contractStatus: 'unavailable', months: {} })).toBeNull();
    expect(contractPlannedOtjh(undefined)).toBeNull();
  });
});
