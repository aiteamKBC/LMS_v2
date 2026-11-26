import type { DashboardMonthlyPlan } from '@/api/dashboardMonthly';

export const dashboardMonthlyFixture = (month = '2026-10'): DashboardMonthlyPlan => ({
  version: 2, month, title: new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  refreshAt: '2099-01-01T00:00:00Z', navigation: { previous: adjacentMonth(month, -1), next: adjacentMonth(month, 1) },
  summary: { requiredHours: '50 hrs', achievedHours: '12 hrs', difference: '-38 hrs', differenceTone: null, differenceDirection: 'down', ksbs: ['K1', 'S2'] },
  activitiesHref: '/learner/modules/commercial/265?subject=current%3AM1', reviews: [], assignments: [], lectures: [],
});

function adjacentMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
