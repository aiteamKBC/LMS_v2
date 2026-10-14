import type { CaseFileOverview } from './hooks/useCaseFileOverview';

export const moduleOverviewFixture: CaseFileOverview['moduleOverview'] = {
  subjects: [
    { id: 'current:M1', title: 'Synthetic module', source: 'current', completed: 20, total: 57,
      dates: [], moduleIds: ['M1'], sessionTitles: [], directHours: 999, ksbProgress: { completed: 0, total: 3 } },
    { id: 'current:M2', title: 'Second module', source: 'current', completed: 1, total: 4,
      dates: [], moduleIds: ['M2'], sessionTitles: [] },
  ],
  modules: [
    { id: 'M1', title: 'Synthetic module', start_date: '2026-01-01', end_date: '2027-01-01', total_otjh: 83 },
    { id: 'M2', title: 'Second module', start_date: '2027-01-02', end_date: '2027-06-01', total_otjh: 10 },
  ],
  moduleLinks: {}, sessions: [], actual: [], actualAvailable: true,
  moduleProgress: {
    M1: { attendance: { attended: 0, total: 12 }, hours: { actual: 4.9 }, ksb: { completed: 15, total: 15 } },
    M2: { attendance: { attended: 2, total: 4 }, hours: { actual: 3.5 }, ksb: { completed: 3, total: 5 } },
  },
};
