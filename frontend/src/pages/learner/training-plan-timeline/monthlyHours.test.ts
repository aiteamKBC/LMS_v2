import { describe, expect, it } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { monthlyHours, totalCompletedHours } from './monthlyHours';

function dashboard(): TrainingPlanDashboard {
  return {
    months: {
      '2026-07': { label: '', topics: [], planned: 70, source: 'contract' },
      '2026-08': { label: '', topics: [], planned: 80, source: 'contract' },
      '2026-09': { label: '', topics: [], planned: 18, source: 'contract' },
      '2026-10': { label: '', topics: [], planned: 20, source: 'contract' },
    },
    monthlyLogOtjh: {
      '2026-07': { target: 10, submitted: 1, completed: 8 },
      '2026-08': { target: 44, submitted: 2, completed: 15 },
    },
    auditOtjhCutoffMonth: '2026-08',
    monthlyOtjh: {
      '2026-08': { planned: 80, submitted: 30, actual: 40, missingPlannedActivities: 0 },
      '2026-09': { planned: 18, submitted: 3, actual: 7, missingPlannedActivities: 0 },
      '2026-10': { planned: 20, submitted: 1, actual: 5, missingPlannedActivities: 0 },
    },
    actual: [
      { month: '2026-08', groupId: null, hours: 99, count: 1 },
      { month: '2026-09', groupId: null, hours: 4, count: 1 },
    ],
    actualAvailable: true,
    modules: [], moduleLinks: {}, sessions: [], reviews: [],
    coach: { name: '', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
  };
}

describe('monthly OTJH totals', () => {
  it('uses retained Audit months through August and LMS completion from September', () => {
    const data = dashboard();

    expect(monthlyHours(data, '2026-07', '2026-10').map(row => [row.key, row.completed])).toEqual([
      ['2026-07', 8],
      ['2026-08', 15],
      ['2026-09', 11],
      ['2026-10', 5],
    ]);
    expect(totalCompletedHours(data, '2026-07', '2026-10')).toBe(39);
  });

  it('returns unavailable when an Audit month is missing instead of substituting LMS hours', () => {
    const data = dashboard();
    delete data.monthlyLogOtjh?.['2026-07'];

    expect(totalCompletedHours(data, '2026-07', '2026-10')).toBeNull();
  });

  it('limits the card total to the same programme months as the chart', () => {
    expect(totalCompletedHours(dashboard(), '2026-08', '2026-09')).toBe(26);
  });
});
