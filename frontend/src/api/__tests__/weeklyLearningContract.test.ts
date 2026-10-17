import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptWeeklyLearning, adaptWeeklyLearningWeek, primeWeeklyLearningWeek, peekWeeklyLearningWeek,
  fetchWeeklyLearningWeek, fetchWeeklyLearning, decodeWeeklyLearning, type WeeklyLearningV2, type CanonicalSelectedWeek } from '../weeklyLearning';
import { clearAllCachedResources } from '../cachedRequest';
import { activityStatus, weekProgress } from '@/pages/workspace/learner/weeklyPlanHelpers';
import type { JourneyComponent } from '@/utils/learnerJourney';

const week: CanonicalSelectedWeek = {
  id: 'M1:2', moduleId: 'M1', moduleTitle: 'Module', weekId: 'W1', weekNumber: 1, slotNumber: 2,
  kind: 'live-session', title: 'Week 1', startDate: '2026-10-20', endDate: '2026-10-26', status: 'upcoming',
  progress: 100, completedActivities: 1, totalActivities: 1, attended: null, sessionState: 'unscheduled', holidayNote: '', holidays: [],
  summary: { completedActivities: 1, totalActivities: 1, progress: 100, ksbCount: 1, achievedKsbCount: 1,
    otjhHours: 0.3333, plannedOtjhHours: 1, untimedActivities: 0 }, liveSession: null,
  activities: [{ id: 'Q1', title: 'Quiz', type: 'quiz', completed: true, status: 'completed', isQuiz: true,
    quizId: 8, expectedHours: 1, actualHours: 0.3333, durationMinutes: null, quizDuration: 60,
    quizTimeUnit: 'mins', ksbCodes: ['K1'], contentAvailable: true }],
};
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });
describe('canonical Student Weekly adapter', () => {
  it.each(['commercial', 'apprenticeship'] as const)('isolates %s learner and module caches while preserving canonical hours', async kind => {
    const otherKind = kind === 'commercial' ? 'apprenticeship' : 'commercial';
    const first = adaptWeeklyLearning({ weeks: [week], selectedWeek: week }, 'synthetic-alpha');
    const otherWeek: CanonicalSelectedWeek = { ...week, id: 'module-beta:9', moduleId: 'module-beta', slotNumber: 9 };
    const second = adaptWeeklyLearning({ weeks: [otherWeek], selectedWeek: otherWeek }, 'synthetic-beta');
    primeWeeklyLearningWeek(kind, 'synthetic-alpha', first);
    primeWeeklyLearningWeek(kind, 'synthetic-beta', second);
    expect(peekWeeklyLearningWeek(kind, 'synthetic-alpha', 'M1', 'slot:M1:2')?.selectedWeek?.summary.otjhHours).toBe(0.3333);
    expect(peekWeeklyLearningWeek(kind, 'synthetic-beta', 'module-beta', 'slot:module-beta:9')?.selectedWeek?.summary).toEqual(week.summary);
    expect(peekWeeklyLearningWeek(kind, 'synthetic-beta', 'M1', 'slot:M1:2')).toBeUndefined();
    expect(peekWeeklyLearningWeek(otherKind, 'synthetic-alpha', 'M1', 'slot:M1:2')).toBeUndefined();
    expect(peekWeeklyLearningWeek(kind, 'synthetic-alpha', 'module-beta', 'slot:module-beta:9')).toBeUndefined();
  });
  it.each(['present', 'absent', 'unmarked', 'upcoming'] as const)('decodes v2 %s attendance without a legacy schedule or duplicate metadata', async attendance => {
    const { moduleTitle, attended, summary, liveSession, activities, ...navigation } = week;
    const payload: WeeklyLearningV2 = { version: 2, modules: [{ id: 'M1', title: moduleTitle }],
      weeks: [{ ...navigation, attendance }], selectedWeek: { weekId: week.id, summary,
        liveSession: null, activities: activities.map(({ completed, ...activity }) => activity) } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    const data = await fetchWeeklyLearning('commercial', '265');
    expect(data.schedule).toBeUndefined();
    expect(data.components).toEqual([]);
    expect(data.wire?.selectedWeek?.activities[0].completed).toBe(true);
    expect(data.wire?.selectedWeek?.attendance).toBe(attendance);
    expect(data.wire?.selectedWeek?.summary).toEqual(week.summary);
    primeWeeklyLearningWeek('commercial', '265', data);
    const cached = await fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(cached.selectedWeek?.activities[0].quizId).toBe(8);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects v2 detail that does not match its navigation reference', () => {
    expect(() => decodeWeeklyLearning({ version: 2, weeks: [], selectedWeek: { weekId: 'other' } } as WeeklyLearningV2)).toThrow('incomplete');
  });
  it('does not turn an incomplete versioned response into a successful empty programme', () => {
    expect(() => decodeWeeklyLearning({ version: 2 } as WeeklyLearningV2)).toThrow('incomplete');
  });
  it('preserves canonical summary while priming the initial slot, without inventing attempt history', () => {
    const data = adaptWeeklyLearning({ weeks: [week], selectedWeek: week }, '265');
    primeWeeklyLearningWeek('commercial', '265', data);
    const cached = peekWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:2');
    expect(cached?.selectedWeek?.summary).toEqual(week.summary);
    expect(cached?.quizAttempts).toEqual([]);
    expect(cached?.components[0].quizMeta?.quizId).toBe(8);
    const components = cached!.components.map(component => ({ ...component, title: component.component })) as JourneyComponent[];
    expect(activityStatus(components[0], new Set())).toBe('completed');
    expect(weekProgress(components, new Set())).toEqual({ completed: 1, total: 1, percent: 100 });
  });
  it('preserves failed quiz status and eligibility without generating a submission', () => {
    const data = adaptWeeklyLearningWeek({ ...week, activities: [{ ...week.activities[0],
      status: 'in-progress', completed: false, contentAvailable: false }] });
    const component = { ...data.components[0], title: data.components[0].component } as JourneyComponent;
    expect(activityStatus(component, new Set())).toBe('in-progress');
    expect(component.contentAvailable).toBe(false);
    expect(data.quizAttempts).toEqual([]);
  });
  it('rejects a response for a different delivery slot or module', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ selectedWeek: week }))));
    await expect(fetchWeeklyLearningWeek('commercial', '265', 'M1', 'slot:M1:1')).rejects.toThrow('incomplete');
    await expect(fetchWeeklyLearningWeek('commercial', '265', 'M2', 'slot:M2:2')).rejects.toThrow('incomplete');
  });
});
