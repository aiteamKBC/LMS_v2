import { describe, expect, it } from 'vitest';
import type { LogSummary } from '@/features/monthly-logs/api';
import { monthlyLogActualOtjh, monthlyLogOtjh } from '../useDashboardPlan';

describe('dashboard OTJH SSOT projection', () => {
  it('maps SSOT monthly values and programme totals into the chart payload', () => {
    const summary = {
      learner: { id: 125, aptem_id: 7001, name: 'Learner', programme: 'Programme', coach_name: '', planned_end_date: '2027-10-17' },
      months: [
        { month: '2025-04', source: 'lms', training_plan_target: '44.00', actual_hours: '61.021944', not_accepted_hours: '2.5' },
        { month: '2026-09', source: 'lms', training_plan_target: 40, actual_hours: 12, not_accepted_hours: 3 },
      ],
      training_plan_totals: { accepted_hours: 73.021944, planned_hours: 84 },
    } as unknown as LogSummary;

    expect(monthlyLogOtjh(summary)).toEqual({
      plannedEndDate: '2027-10-17',
      acceptedTotal: 73.021944,
      plannedTotal: 84,
      months: {
        '2025-04': { target: 44, submitted: 2.5, completed: 61.021944 },
        '2026-09': { target: 40, submitted: 3, completed: 12 },
      },
    });
  });

  it('keeps a learner entirely on SSOT calculations', () => {
    const summary = {
      learner: { id: 125, aptem_id: null, name: 'Learner', programme: 'Programme', coach_name: '' },
      months: [{ month: '2026-09', source: 'lms', training_plan_target: 40, actual_hours: 12, not_accepted_hours: 3 }],
      training_plan_totals: { accepted_hours: 12, planned_hours: 40 },
    } as unknown as LogSummary;

    expect(monthlyLogOtjh(summary)).toEqual({
      months: { '2026-09': { target: 40, submitted: 3, completed: 12 } },
      plannedEndDate: null,
      acceptedTotal: 12,
      plannedTotal: 40,
    });
  });

  it('sums accepted SSOT log months once', () => {
    expect(monthlyLogActualOtjh({
      '2026-08': { completed: 18 },
      '2026-09': { completed: 2.5 },
      '2026-10': { completed: 1.25 },
    })).toBe(21.75);
    expect(monthlyLogActualOtjh(undefined)).toBeNull();
    expect(monthlyLogActualOtjh({})).toBe(0);
  });
});
