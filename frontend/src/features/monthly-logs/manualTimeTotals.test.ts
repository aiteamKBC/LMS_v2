import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { fetchLearnerMetrics, peekLearnerMetrics } from '@/api/learnerMetrics';
import { fetchDashboardMonthly, peekDashboardMonthly } from '@/api/dashboardMonthly';
import { caseFileRead } from '@/features/coach/case-file/api/caseFileApi';
import { clearCoachViewAs } from '@/lib/coachViewAs';
import { correctLogManualTime } from './api';

beforeEach(() => { clearAllCachedResources(); clearCoachViewAs(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

it.each(['commercial', 'apprenticeship'] as const)('refreshes cached learner and coach totals immediately after a %s correction', async kind => {
  let actual = 40;
  vi.stubGlobal('fetch', vi.fn(async (input, options) => {
    const url = String(input);
    let data: unknown;
    if (options?.method === 'POST' && url.includes('/manual-time/')) {
      actual = 10.5;
      data = { correction: { learner_kind: kind, learner_id: '7' }, detail: { month: '2026-10', actual_hours: actual } };
    } else if (url.includes('/metrics/')) {
      data = { migrated: true, programme: { status: 'ready' }, ksb: { status: 'ready' }, otjh: { actual, planned: 100 } };
    } else if (url.includes('/monthly/plan/')) {
      data = { version: 2, month: '2026-10', title: 'October 2026', refreshAt: new Date(Date.now() + 86_400_000).toISOString(),
        navigation: { previous: null, next: null }, summary: { requiredHours: '100', achievedHours: String(actual),
          difference: String(100 - actual), differenceDirection: 'down', ksbs: [] }, reviews: [], assignments: [], lectures: [] };
    } else if (url.includes('/case-file/70/otjh-ksb')) {
      data = { otjh: { actualHours: actual, plannedHours: 100, remainingHours: 100 - actual } };
    } else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(data));
  }));
  type CaseTotals = { otjh: { actualHours: number; plannedHours: number; remainingHours: number } };
  const reads = () => Promise.all([
    fetchLearnerMetrics(kind, '7'), fetchDashboardMonthly(kind, '7', '2026-10'),
    caseFileRead<CaseTotals>('coach@example.test', '70', 'otjh-ksb'),
  ]);
  const before = await reads();
  expect(before[0].otjh.actual).toBe(40);
  expect(before[1].summary.achievedHours).toBe('40');
  expect(before[2].otjh).toEqual({ actualHours: 40, plannedHours: 100, remainingHours: 60 });
  await reads();
  expect(fetch).toHaveBeenCalledTimes(3);

  await correctLogManualTime('7', '2026-10', 1, { seconds: 1800, revision: 'original', reason: 'Correct units' }, 'csrf', 'coach');
  expect(peekLearnerMetrics(kind, '7')).toBeUndefined();
  expect(peekDashboardMonthly(kind, '7', '2026-10')).toBeUndefined();
  const after = await reads();
  expect(after[0].otjh.actual).toBe(10.5);
  expect(after[1].summary.achievedHours).toBe('10.5');
  expect(after[2].otjh).toEqual({ actualHours: 10.5, plannedHours: 100, remainingHours: 89.5 });
  expect(fetch).toHaveBeenCalledTimes(7);
});

it.each(['commercial', 'apprenticeship'] as const)('retains valid %s totals when the correction is refused', async kind => {
  vi.stubGlobal('fetch', vi.fn(async (_input, options) => options?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'The monthly log is signed.' }), { status: 409 })
    : new Response(JSON.stringify({ programme: { status: 'ready' }, ksb: { status: 'ready' }, otjh: { actual: 40, planned: 100 } }))));
  const before = await fetchLearnerMetrics(kind, '7');
  await expect(correctLogManualTime('7', '2026-10', 1,
    { seconds: 1800, revision: 'original', reason: 'Correct units' }, 'csrf', 'learner')).rejects.toThrow('The monthly log is signed.');
  expect(await fetchLearnerMetrics(kind, '7')).toBe(before);
  expect(fetch).toHaveBeenCalledTimes(2);
});
