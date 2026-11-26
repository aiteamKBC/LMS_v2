import type { DashboardOverviewPayload } from '@/api/dashboardTabs';
export function dashboardOverviewFixture(): DashboardOverviewPayload {
  return {
    metrics: { ksb: { completed: 1, total: 2, percent: 50 },
      otjh: { actual: 12, targetToDate: 40 } },
    attendance: { present: 1, sessions: 2 }, reviews: { completed: 1, total: 2, percent: 50 },
    modules: [{ id: 'current:M1', title: 'Module', start: '2026-09-01', end: '2026-11-30',
      activities: { completed: 1, total: 2 }, attendance: { attended: 1, total: 2 },
      hours: { actual: 12, planned: 50 }, ksb: { completed: 1, total: 2 } }],
    programme: [{ id: 'current:M1', title: 'Module', percent: 50 }],
    hours: { months: [{ key: '2026-10', target: 20, submitted: 3, completed: 12 }], planned: 100, end: '2026-11' },
    programmeStartDate: '2026-09-01', programmeEndDate: '2026-11-30',
  };
}
