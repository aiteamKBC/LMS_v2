import type { DashboardMonthlyPlan } from '@/api/dashboardMonthly';

export const dashboardMonthlyFixture = (month = '2026-10'): DashboardMonthlyPlan => ({
  month, navigation: { previous: adjacentMonth(month, -1), next: adjacentMonth(month, 1) },
  summary: { requiredHours: 50, achievedHours: 12, ksbs: ['K1', 'S2'] }, topics: [], contractStatus: 'ready',
  selectedSubjectId: 'current:M1', coachName: 'Coach', reviews: [], assignments: [], lectures: [],
});

function adjacentMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
