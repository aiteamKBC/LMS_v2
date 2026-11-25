import { describe, expect, it } from 'vitest';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { employerPerformance, modulePerformance, mean } from './employerPerformanceData';

const learners: EmployerLearnerCard[] = [
  { id: '11', kind: 'apprenticeship', name: 'Alex', email: 'alex@example.test', programme: 'Test', cohort: '', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: { actual: 10, planned: 20, percent: 50 } },
  { id: '12', kind: 'commercial', name: 'Morgan', email: 'morgan@example.test', programme: 'Test', cohort: '', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: { actual: 30, planned: 120, percent: 25 } },
];
const first = dashboardOverviewFixture();
first.modules[0].assignments = { submitted: 1, total: 2 };
const second = dashboardOverviewFixture();
second.modules[0].assignments = { submitted: 9, total: 10 };
const records = { 'apprenticeship:11': { status: 'ready' as const, data: first }, 'commercial:12': { status: 'ready' as const, data: second } };

describe('employer learning averages', () => {
  it('gives each learner equal weight instead of pooling assignment denominators', () => {
    const summary = employerPerformance(learners, records, {
      'apprenticeship:11': { status: 'ready', data: { present: 1, sessions: 2, attendanceRate: 50, absent: 1, late: 0 } },
      'commercial:12': { status: 'ready', data: { present: 9, sessions: 10, attendanceRate: 90, absent: 1, late: 0 } },
    }, {});
    expect(summary.rates[0].value).toBe(70);
    expect(summary.rates[1].value).toBe(70);
    expect(summary.hours.value).toBe(20);
    expect(summary.rates[2].value).toBe(37.5);
  });

  it('preserves real zeroes and excludes unavailable, invalid and unassigned data', () => {
    expect(mean([null, undefined, NaN, Infinity, -1, 0, 100])).toEqual({ value: 50, available: 2 });
    const payload = structuredClone(first);
    delete payload.modules[0].assignments;
    const summary = employerPerformance([learners[0]], { 'apprenticeship:11': { status: 'ready', data: payload } }, {}, {});
    expect(summary.rates[1].value).toBeNull();
    expect(summary.reviewsAvailable).toBe(0);
  });

  it('limits the chart to the exact selected module and current learners', () => {
    const payload = structuredClone(first);
    payload.modules.push({ ...payload.modules[0], id: 'current:M2', title: 'Second module', hours: { actual: 0, planned: 100 }, assignments: { submitted: 0, total: 1 } });
    const scoped = { ...records, 'apprenticeship:11': { status: 'ready' as const, data: payload } };
    const selected = modulePerformance([learners[0]], scoped, 'current:M2');
    expect(selected.rows).toHaveLength(1);
    expect(selected.measures[0].value).toBe(0);
    expect(selected.measures[2].value).toBe(0);
    expect(modulePerformance([learners[0]], scoped, 'current:missing').rows).toEqual([]);
    expect(modulePerformance([learners[1]], scoped, 'current:M1').measures[2].value).toBe(90);
  });
});
