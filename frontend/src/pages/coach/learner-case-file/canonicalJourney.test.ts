import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { buildUnifiedLearningSummary, type CoverMetadata } from '@/pages/learner/my-learning/learningSummary';
import { buildFullCaseFileJourney, buildCaseFileActivityStates, moduleActivitySummary } from './activityState';

const activity = (group: number, id: number, completed = false) => ({
  activity_id: `record:${group}:${id}`, group_id: group, source_activity_id: id,
  activity: 'Activity', category: 'reading', completed, planned: 1,
  status: completed ? 'completed' : 'not_started', section_title: `Week ${id}`,
});
const data = {
  progress_basis: 'recorded_activities',
  subjects: [{ id: 10, name: 'Same name', module_id: 'historical-a' }, { id: 20, name: 'Same name', module_id: 'historical-b' }],
  activities: [activity(10, 1, true), activity(10, 2), activity(20, 3)],
} as StudentActivityResponse;
const detail = {
  studentActivityAvailable: true, modules: [], week: [], components: [],
  quizAttempts: [], videoProgress: [], componentProgress: [], activityFeed: [], componentMarkingStatus: {},
} as unknown as LearnerDetail;
const metadata: CoverMetadata = { covers: {}, current_subjects: [{ id: 'current-a', title: 'Same name' }, { id: 'current-b', title: 'Same name' }] };
const fallback = [{ module: 'Safe native fallback', weeks: [] }];

describe('canonical Coach Programme Journey', () => {
  it('returns exactly My Learning subjects and stable IDs for an Aptem learner', () => {
    const learner = buildUnifiedLearningSummary(data, detail, metadata);
    const coach = buildFullCaseFileJourney(fallback, data, detail, metadata);
    expect(coach.map(m => [m.id, m.module])).toEqual(learner.subjects.map(s => [s.id, s.title]));
    expect(coach).toHaveLength(4);
    expect(coach.find(m => m.id === 'legacy:10')!.weeks).toHaveLength(2);
    const states = buildCaseFileActivityStates(coach, detail, data);
    expect(coach.reduce((sum, m) => sum + moduleActivitySummary(m, states).total, 0)).toBe(learner.activityCount);
    expect(coach.reduce((sum, m) => sum + moduleActivitySummary(m, states).completed, 0)).toBe(learner.completedActivityCount);
  });

  it('deduplicates subject and activity IDs at the shared source before counts and OTJH', () => {
    const duplicated = { ...data, subjects: [...data.subjects!, data.subjects![0]], activities: [...data.activities, data.activities[0]] };
    const coach = buildFullCaseFileJourney(fallback, duplicated, detail, metadata);
    expect(coach).toHaveLength(4);
    const module = coach.find(m => m.id === 'legacy:10')!;
    expect(module.weeks.flatMap(w => w.components)).toHaveLength(2);
    expect(module.weeks.reduce((sum, w) => sum + w.otjh, 0)).toBe(2);
    expect(moduleActivitySummary(module, buildCaseFileActivityStates(coach, detail, duplicated))).toMatchObject({ total: 2, completed: 1 });
  });

  it('never merges different canonical IDs with identical names', () => {
    const coach = buildFullCaseFileJourney([], data, detail, metadata);
    expect(new Set(coach.map(m => m.id)).size).toBe(4);
    expect(coach.map(m => m.module)).toEqual(Array(4).fill('Same name'));
  });

  it('keeps all weeks of a current canonical module inside one module', () => {
    const current = { ...detail, components: [1, 2, 3].map(id => ({
      moduleId: 'current-a', module: 'Same name', weekId: `week-${id}`, week: `Week ${id}`,
      componentId: `component-${id}`, component: 'Reading', type: 'reading', expectedOtjh: 2,
    })) } as LearnerDetail;
    const coach = buildFullCaseFileJourney([], data, current, metadata);
    expect(coach).toHaveLength(4);
    expect(coach.find(m => m.id === 'current:current-a')!.weeks).toHaveLength(3);
    const states = buildCaseFileActivityStates(coach, current, data);
    expect(moduleActivitySummary(coach.find(m => m.id === 'current:current-a')!, states)).toMatchObject({ total: 3, 'not-started': 3 });
  });

  it('retains the existing fallback for a learner without an Aptem ID', () => {
    expect(buildFullCaseFileJourney(fallback, null, { ...detail, studentActivityAvailable: false })).toBe(fallback);
  });

  it('preserves recorded historical quiz planned hours without adding native quiz duration', () => {
    const historical = { ...data, activities: [{ ...activity(10, 1), category: 'quiz', catalogue_kind: 'quiz' }] } as StudentActivityResponse;
    const current = { ...detail, components: [{ moduleId: 'current-a', module: 'Same name',
      week: 'Week 1', component: 'Quiz', type: 'quiz', isQuiz: true, expectedOtjh: 2,
      quizMeta: { quizId: 999 },
    }] } as LearnerDetail;
    const coach = buildFullCaseFileJourney([], historical, current, metadata);
    expect(coach.find(m => m.id === 'legacy:10')!.weeks[0].otjh).toBe(1);
    expect(coach.find(m => m.id === 'current:current-a')!.weeks[0].otjh).toBe(0);
  });

  it('counts native progress only within its subject and ignores repeated component rows', () => {
    const component = { moduleId: 'current-a', module: 'Same name', weekId: 'w', week: 'Week 1',
      componentId: 'started-video', component: 'Video', type: 'video', expectedOtjh: 2 };
    const current = { ...detail, components: [component, component], videoProgress: [{
      kind: 'video', componentId: 'started-video', passed: false, startedAt: '2026-09-01T09:00:00Z',
      submittedAt: null, timeTaken: null,
    }] } as LearnerDetail;
    const coach = buildFullCaseFileJourney([], data, current, metadata);
    const states = buildCaseFileActivityStates(coach, current, data);
    expect(moduleActivitySummary(coach.find(m => m.id === 'current:current-a')!, states)).toMatchObject({ total: 1, 'in-progress': 1 });
    expect(moduleActivitySummary(coach.find(m => m.id === 'current:current-b')!, states)).toMatchObject({ total: 0, 'in-progress': 0 });
    expect(coach.find(m => m.id === 'current:current-a')!.weeks[0].otjh).toBe(2);
  });

  it('does not reconstruct modules when canonical data or metadata is unavailable', () => {
    expect(buildFullCaseFileJourney(fallback, null, detail, metadata)).toEqual([]);
    expect(buildFullCaseFileJourney(fallback, data, detail, null)).toEqual([]);
    expect(buildFullCaseFileJourney(fallback, null, { ...detail, studentActivityAvailable: false }, null, true)).toEqual([]);
  });
});
