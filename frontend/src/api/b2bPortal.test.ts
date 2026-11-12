import { describe, expect, it } from 'vitest';
import { buildB2BPortalData, withCompanyDemoTraining } from './b2bPortal';

describe('B2B company progress aggregation', () => {
  it('counts employees without a started progress record as zero', () => {
    const result = buildB2BPortalData({
      employer: { id: 'company-1', name: 'Example Ltd', email: '', employerGroupNames: [] },
      learners: [
        { id: '1', kind: 'apprenticeship', name: 'Started Learner', email: '', programme: 'Programme', cohort: '', programmeStatus: 'Active', onboardingStatus: 'Active', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: null },
        { id: '2', kind: 'apprenticeship', name: 'Not Started Learner', email: '', programme: 'Programme', cohort: '', programmeStatus: 'Active', onboardingStatus: 'Active', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: null },
      ],
      outstandingTotal: 0,
    }, {
      asOf: '2026-11-12T09:00:00Z',
      learners: {
        '1': { programme: { completed: 5, total: 10, percent: 80, status: 'ready' }, otjh: { actual: 10, planned: 20, percent: 50 }, attendance: null, risk: 'on-track' },
        '2': { programme: null, otjh: null, attendance: null, risk: 'unavailable' },
      },
    });

    expect(result.company.averageProgress).toBe(40);
    expect(result.progress.startedCount).toBe(1);
    expect(result.progress.notStartedCount).toBe(1);
  });
});

it('includes assigned employees in demo totals with weighted module progress and keeps demo identity explicit', () => {
  const base = buildB2BPortalData({ employer: { id: '340', name: 'Company', email: '', employerGroupNames: [] }, learners: [], outstandingTotal: 0 });
  const data = withCompanyDemoTraining(base, { modules: [{ id: 'm1', name: 'First', plannedHours: 100, ksbs: 4 }, { id: 'm2', name: 'Second', plannedHours: 300, ksbs: 8 }], departments: [], rules: [], employees: [{ id: 'external-person', name: 'Demo employee', departmentId: '', department: '', allocations: [{ moduleId: 'm1', metrics: { progress: 100, hours: 100 } }, { moduleId: 'm2', metrics: { progress: 0, hours: 0 } }] }] });
  expect(data.company.employees).toBe(1);
  expect(data.company.averageProgress).toBe(25);
  expect(data.employees[0].demoTraining).toBe(true);
  expect(data.portal.learners).toEqual([]);
});
