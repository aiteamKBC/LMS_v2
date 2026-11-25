import { weeklyResourceFixture } from '@/test/weeklyContractFixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { primeWeeklyLearningWeek, peekWeeklyLearningWeek,
  fetchWeeklyLearningWeek, fetchWeeklyLearning, type WeeklyLearningResponse } from '../weeklyLearning';
import { clearAllCachedResources } from '../cachedRequest';
import { activityStatus, weekProgress } from '@/pages/workspace/learner/weeklyPlanHelpers';
import { canonicalActivityRows } from '@/pages/workspace/learner/weeklyPlanPresentation';
import { validateWeeklyLearning, attendedEvidence } from '../weeklyLearningContract';

const resource: WeeklyLearningResponse = {
  modules: [{ id: 'M1', title: 'Module' }],
  weeks: [{ id: 'M1:2', moduleId: 'M1', weekId: 'W1', weekNumber: 1, slotNumber: 2,
    kind: 'live-session', title: 'Week 1', startDate: '2026-10-20', endDate: '2026-10-26', status: 'upcoming',
    progress: 100, completedActivities: 1, totalActivities: 1, attendance: 'unmarked', sessionState: 'unscheduled', holidayNote: '', holidays: [] }],
  selectedWeek: { weekId: 'M1:2', summary: { ksbCount: 1, achievedKsbCount: 1, otjhHours: 0.3333, plannedOtjhHours: 1, untimedActivities: 0 }, liveSession: null,
    activities: [{ id: 'Q1', title: 'Quiz', type: 'quiz', status: 'completed', isQuiz: true,
      quizId: 8, expectedHours: 1, actualHours: 0.3333, durationMinutes: null, quizDuration: 60,
      quizTimeUnit: 'mins', ksbCodes: ['K1'], contentAvailable: true }] },
};
const week = resource.selectedWeek!;
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });
describe('single canonical Weekly resource', () => {
  it.each(['commercial', 'apprenticeship'] as const)('isolates %s learner and module caches while preserving canonical hours', async kind => {
    const otherKind = kind === 'commercial' ? 'apprenticeship' : 'commercial';
    const first = weeklyResourceFixture(resource, 'synthetic-alpha');
    const second = weeklyResourceFixture({ ...resource, modules: [{id: 'module-beta', title: 'Other'}],
      weeks: [{...resource.weeks[0], id: 'module-beta:9', moduleId: 'module-beta', slotNumber: 9}],
      selectedWeek: {...week, weekId: 'module-beta:9'} }, 'synthetic-beta');
    primeWeeklyLearningWeek(kind, 'synthetic-alpha', first);
    primeWeeklyLearningWeek(kind, 'synthetic-beta', second);
    expect(peekWeeklyLearningWeek(kind, 'synthetic-alpha', 'M1', 'slot:M1:2')?.selectedWeek?.summary.otjhHours).toBe(0.3333);
    expect(peekWeeklyLearningWeek(kind, 'synthetic-beta', 'module-beta', 'slot:module-beta:9')?.selectedWeek?.summary).toEqual(week.summary);
    expect(peekWeeklyLearningWeek(kind, 'synthetic-beta', 'M1', 'slot:M1:2')).toBeUndefined();
    expect(peekWeeklyLearningWeek(otherKind, 'synthetic-alpha', 'M1', 'slot:M1:2')).toBeUndefined();
    expect(peekWeeklyLearningWeek(kind, 'synthetic-alpha', 'module-beta', 'slot:module-beta:9')).toBeUndefined();
  });
  it.each(['present', 'absent', 'unmarked', 'upcoming'] as const)('uses canonical %s attendance and primes selected detail without another request', async attendance => {
    const payload: WeeklyLearningResponse = { ...resource, weeks: [{ ...resource.weeks[0], attendance }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    const data = await fetchWeeklyLearning('commercial', '265');
    expect(data.weeks[0].attendance).toBe(attendance);
    expect(data.selectedWeek?.summary).toEqual(week.summary);
    expect(data).not.toHaveProperty('version');
    expect(data).not.toHaveProperty('components');
    primeWeeklyLearningWeek('commercial', '265', data);
    const cached = await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(cached.selectedWeek?.activities[0].quizId).toBe(8);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(attendedEvidence(attendance)).toBe(attendance === 'present' ? true : attendance === 'absent' ? false : null);
  });
  it('rejects detail that does not match its navigation reference', () => {
    expect(() => validateWeeklyLearning({ ...resource, selectedWeek: {...week, weekId: 'other'} })).toThrow('incomplete');
  });
  it('does not turn an incomplete response into a successful empty programme', () => {
    expect(() => validateWeeklyLearning({} as WeeklyLearningResponse)).toThrow('incomplete');
  });
  it('preserves canonical summary while priming the initial slot, without inventing attempt history', () => {
    const data = weeklyResourceFixture(resource, '265');
    primeWeeklyLearningWeek('commercial', '265', data);
    const cached = peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(cached?.selectedWeek?.summary).toEqual(week.summary);
    expect(cached).not.toHaveProperty('quizAttempts');
    expect(cached?.selectedWeek?.activities[0].quizId).toBe(8);
    const components = canonicalActivityRows(cached!.selectedWeek!);
    expect(activityStatus(components[0], new Set())).toBe('completed');
    expect(weekProgress(components, new Set())).toEqual({ completed: 1, total: 1, percent: 100 });
  });
  it('preserves failed quiz status and eligibility without generating a submission', () => {
    const selected = ({ ...week, activities: [{ ...week.activities[0],
      status: 'in-progress' as const, contentAvailable: false }] });
    const component = canonicalActivityRows(selected)[0];
    expect(activityStatus(component, new Set())).toBe('in-progress');
    expect(component.contentAvailable).toBe(false);
    expect(selected).not.toHaveProperty('quizAttempts');
  });
  it('rejects a response for a different delivery slot or module', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resource))));
    await expect(fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1')).rejects.toThrow('incomplete');
    await expect(fetchWeeklyLearningWeek('commercial', '265', 'M2', 'slot:M2:2')).rejects.toThrow('incomplete');
  });
  it('keeps automatic, manual and full navigation reads in separate cache entries', async () => {
    const current: WeeklyLearningResponse = { ...resource, modules: [{ id: 'M2', title: 'Current' }],
      weeks: [{ ...resource.weeks[0], id: 'M2:2', moduleId: 'M2' }], selectedWeek: { ...week, weekId: 'M2:2' } };
    vi.stubGlobal('fetch', vi.fn(async input => new Response(JSON.stringify(
      String(input).includes('preferCurrent=1') ? current : resource))));
    await fetchWeeklyLearning('commercial', '265', { moduleId: 'M1', moduleNavigation: true });
    await fetchWeeklyLearning('commercial', '265', { moduleId: 'M1', moduleNavigation: true, preferCurrent: false });
    await fetchWeeklyLearning('commercial', '265', { moduleId: 'M1' });
    await fetchWeeklyLearning('commercial', '265', { moduleId: 'M1', moduleNavigation: true });
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
      '/learner_api/dashboard/commercial/265/weekly/plan/?moduleId=M1&navigation=module&preferCurrent=1',
      '/learner_api/dashboard/commercial/265/weekly/plan/?moduleId=M1&navigation=module&preferCurrent=0',
      '/learner_api/dashboard/commercial/265/weekly/plan/?moduleId=M1',
    ]);
  });
  it('refreshing one module keeps a cached week in another module', async () => {
    const other: WeeklyLearningResponse = { ...resource, modules: [{ id: 'M2', title: 'Other' }],
      weeks: [{ ...resource.weeks[0], id: 'M2:2', moduleId: 'M2' }],
      selectedWeek: { ...week, weekId: 'M2:2' } };
    const saved = weeklyResourceFixture(other, '265');
    primeWeeklyLearningWeek('commercial', '265', saved);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resource))));
    await fetchWeeklyLearning('commercial', '265', { moduleId: 'M1', moduleNavigation: true, revalidate: true });
    expect(peekWeeklyLearningWeek('commercial', '265', 'M2', 'slot:M2:2')?.selectedWeek).toEqual(saved.selectedWeek);
  });
  it('reuses the displayed module on a manual return, including after an account cache reset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(resource))));
    for (let account = 0; account < 2; account += 1) {
      clearAllCachedResources();
      const automatic = await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true });
      const manual = await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true, moduleId: 'M1', preferCurrent: false });
      expect(manual).toBe(automatic);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('an automatic response never replaces a manual module read already in flight', async () => {
    let finish!: () => void;
    vi.stubGlobal('fetch', vi.fn(async input => {
      const manual = String(input).includes('preferCurrent=0');
      if (manual) await new Promise<void>(resolve => { finish = resolve; });
      return new Response(JSON.stringify({ ...resource, selectedWeek: { ...week,
        activities: [{ ...week.activities[0], title: manual ? 'Manual response' : 'Automatic response' }] } }));
    }));
    const pending = fetchWeeklyLearning('commercial', '265', { moduleNavigation: true, moduleId: 'M1', preferCurrent: false });
    await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true });
    finish();
    const manual = await pending;
    expect(manual.selectedWeek?.activities[0].title).toBe('Manual response');
    expect(await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true, moduleId: 'M1', preferCurrent: false })).toBe(manual);
  });
  it('refreshing the automatic rail updates its primed manual snapshot', async () => {
    let version = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...resource,
      selectedWeek: { ...week, activities: [{ ...week.activities[0], title: `Version ${++version}` }] } }))));
    const automatic = await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true });
    expect(await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true, moduleId: 'M1', preferCurrent: false })).toBe(automatic);
    const refreshed = await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true, revalidate: true });
    expect(refreshed.selectedWeek?.activities[0].title).toBe('Version 2');
    expect(await fetchWeeklyLearning('commercial', '265', { moduleNavigation: true, moduleId: 'M1', preferCurrent: false })).toBe(refreshed);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
