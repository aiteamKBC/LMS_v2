import type { CaseFileOverview } from './hooks/useCaseFileOverview';

export const moduleOverviewFixture: CaseFileOverview['moduleOverview'] = {
  learning: {
    detail: {
      modules: ['Synthetic module', 'Second module'],
      components: [{ id: 'M1', title: 'Synthetic module', count: 57 }, { id: 'M2', title: 'Second module', count: 4 }]
        .flatMap(module => Array.from({ length: module.count }, (_, index) => ({
          moduleId: module.id, module: module.title, componentId: `${module.id}:${index}`,
          component: `Activity ${index}`, week: 'Week 1', expectedOtjh: null,
        }))),
      quizAttempts: [],
      componentProgress: [{ id: 'M1', count: 20 }, { id: 'M2', count: 1 }]
        .flatMap(module => Array.from({ length: module.count }, (_, index) => ({
          kind: 'component' as const, componentId: `${module.id}:${index}`, componentType: 'reading',
          startedAt: null, submittedAt: '', timeTaken: null,
        }))),
    },
    activity: null,
    metadata: { covers: {} },
  },
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
