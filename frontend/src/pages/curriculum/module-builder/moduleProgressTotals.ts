import type { CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';

type ModuleHoursLearner = NonNullable<CurriculumScopeLearnerKsbImpactResponse['activityLogOtjh']>['learners'][number];

/** Recompute each header from exactly the visible, explicitly resolved learners. */
export function moduleProgressTotals(impact: CurriculumScopeLearnerKsbImpactResponse, learnerIds: Array<string | null>) {
  const lookup = <T extends { learnerId: string | number }>(rows: T[] | undefined) =>
    learnerIds.map(id => id == null ? undefined : rows?.find(row => String(row.learnerId) === id));
  const activities = lookup(impact.activityLogProgress?.learners);
  const hours = lookup<ModuleHoursLearner>(impact.activityLogOtjh?.learners ?? impact.otjhAchievement?.learners);
  const ksbs = lookup(impact.learnerKsbConsumption);
  const activitiesKnown = activities.every(Boolean);
  const hoursKnown = hours.every(row => row && row.achievedOtjh != null);
  const ksbsKnown = ksbs.every(Boolean);
  const sum = <T>(rows: Array<T | undefined>, value: (row: T) => number) => rows.reduce((total, row) => total + (row ? value(row) : 0), 0);
  return {
    activity: impact.activityLogProgress ? {
      known: activitiesKnown,
      completed: sum(activities, row => row.completedActivities),
      total: sum(activities, row => row.totalActivities),
      earlier: sum(activities, row => row.earlierRecords),
    } : undefined,
    hoursKnown,
    hoursTargetsKnown: hours.every(Boolean),
    hours: hoursKnown ? sum(hours, row => row.achievedOtjh || 0) : null,
    plannedHours: sum(hours, row => row.plannedOtjh),
    historicalHours: sum(lookup(impact.activityLogOtjh?.learners), row => row.historicalOtjh || 0),
    historicalUnallocatedHours: sum(lookup(impact.activityLogOtjh?.learners), row => row.historicalUnallocatedRecords || 0),
    unallocatedHours: sum(lookup(impact.activityLogOtjh?.learners), row => row.unallocatedAcceptedRecords || 0),
    ksbsKnown,
    achievedKsb: sum(ksbs, row => row.cappedConsumedWeightTotal ?? row.consumedWeightTotal),
    expectedKsb: sum(ksbs, row => row.expectedWeightTotal),
    historicalKsb: sum(ksbs, row => row.historicalConsumedWeightTotal || 0),
    unallocatedKsb: sum(ksbs, row => row.unallocatedPlannedWeight || 0),
    unavailable: learnerIds.filter((id, index) => id == null || !hours[index] || !ksbs[index]).length,
  };
}
