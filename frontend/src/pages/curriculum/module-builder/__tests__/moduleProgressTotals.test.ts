import { expect, it } from 'vitest';
import type { CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';
import { moduleProgressTotals } from '../moduleProgressTotals';

const impact = {
  moduleProgressBasis: 'current_activities',
  activityLogProgress: { learners: [
    { learnerId: 1, completedActivities: 1, totalActivities: 3, earlierRecords: 2 },
    { learnerId: 2, completedActivities: 2, totalActivities: 5, earlierRecords: 4 },
  ] },
  activityLogOtjh: { learners: [
    { learnerId: 1, achievedOtjh: 1, plannedOtjh: 3, historicalOtjh: 10, unallocatedAcceptedRecords: 0 },
    { learnerId: 2, achievedOtjh: 2, plannedOtjh: 5, historicalOtjh: 20, unallocatedAcceptedRecords: 1 },
  ] },
  learnerKsbConsumption: [
    { learnerId: 1, cappedConsumedWeightTotal: 50, consumedWeightTotal: 80, expectedWeightTotal: 100, historicalConsumedWeightTotal: 30 },
    { learnerId: 2, cappedConsumedWeightTotal: 20, consumedWeightTotal: 20, expectedWeightTotal: 100, historicalConsumedWeightTotal: 40 },
  ],
} as unknown as CurriculumScopeLearnerKsbImpactResponse;

it('uses the selected learners only and keeps historical evidence outside the numerator', () => {
  const totals = moduleProgressTotals(impact, ['1']);
  expect(totals.activity).toEqual({ known: true, completed: 1, total: 3, earlier: 2 });
  expect(totals.hours).toBe(1);
  expect(totals.plannedHours).toBe(3);
  expect(totals.historicalHours).toBe(10);
  expect(totals.achievedKsb).toBe(50);
  expect(totals.expectedKsb).toBe(100);
  expect(totals.historicalKsb).toBe(30);
  expect(moduleProgressTotals(impact, ['1', '2']).achievedKsb).toBe(70);
});

it('does not fabricate zero when the profile or metric read is missing', () => {
  const totals = moduleProgressTotals(impact, ['1', null, 'missing']);
  expect(totals.unavailable).toBe(2);
  expect(totals.activity?.known).toBe(false);
  expect(totals.hours).toBeNull();
  expect(totals.hoursTargetsKnown).toBe(false);
  expect(totals.ksbsKnown).toBe(false);
});

it('keeps a genuinely empty filter separate from a failed or incomplete read', () => {
  const totals = moduleProgressTotals(impact, []);
  expect(totals.hours).toBe(0);
  expect(totals.plannedHours).toBe(0);
  expect(totals.achievedKsb).toBe(0);
  expect(totals.expectedKsb).toBe(0);
  expect(totals.unavailable).toBe(0);
});
