import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptWeeklyLearning, adaptWeeklyLearningWeek, primeWeeklyLearningWeek, peekWeeklyLearningWeek,
  fetchWeeklyLearningWeek, type CanonicalSelectedWeek } from '../weeklyLearning';
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
