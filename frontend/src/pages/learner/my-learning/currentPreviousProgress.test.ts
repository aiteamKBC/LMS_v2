import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { buildUnifiedLearningSummary } from './learningSummary';

const history = {
  progress_basis: 'catalogue_activities',
  subjects: [{ id: 1, name: 'Shared module', module_id: 'M1' }],
  activities: [{ group_id: 1, activity_id: 'catalogue:1:material:1', source_activity_id: 1,
    activity: 'Previous lesson', completed: true, category: 'reading' }],
} as StudentActivityResponse;
const current = {
  modules: ['Shared module'], components: [
    { moduleId: 'M1', module: 'Shared module', componentId: 'C1', component: 'Current lesson', type: 'reading' },
    { moduleId: 'M1', module: 'Shared module', componentId: 'Q1', component: 'Current quiz', isQuiz: true, quizMeta: { quizId: 10 } },
  ], componentProgress: [], quizAttempts: [],
} as unknown as LearnerDetail;

describe('current plan and previous learning progress', () => {
  it('updates current completion independently of previous learning in the same module', () => {
    const before = buildUnifiedLearningSummary(history, current);
    const after = buildUnifiedLearningSummary(history, { ...current,
      componentProgress: [{ componentId: 'C1', kind: 'component', passed: null }],
      quizAttempts: [{ quizId: 10, grade: 1, passed: true }, { quizId: 10, grade: 0, passed: false }],
    } as unknown as LearnerDetail);
    expect(before.subjects.map(subject => subject.id)).toEqual(['current:M1', 'legacy:1']);
    expect([before.activityCount, before.completedActivityCount, before.percent]).toEqual([2, 0, 0]);
    expect([after.activityCount, after.completedActivityCount, after.percent]).toEqual([2, 2, 100]);
    expect(after.previousLearning).toEqual(before.previousLearning);
    expect(after.previousLearning).toEqual({ activityCount: 1, completedActivityCount: 1, percent: 100 });
    expect(current.componentProgress).toEqual([]);
  });

  it('deduplicates repeated placements without mixing the two populations', () => {
    const summary = buildUnifiedLearningSummary({ ...history, activities: [...history.activities, ...history.activities] },
      { ...current, components: [...current.components, ...current.components] });
    expect(summary.activityCount).toBe(2);
    expect(summary.previousLearning?.activityCount).toBe(1);
  });

  it('keeps history-only, current-only and empty learners independent', () => {
    expect(buildUnifiedLearningSummary(history, null)).toMatchObject({ activityCount: 0,
      previousLearning: { activityCount: 1, completedActivityCount: 1 } });
    expect(buildUnifiedLearningSummary(null, current)).toMatchObject({ activityCount: 2, completedActivityCount: 0,
      previousLearning: { activityCount: 0 } });
    expect(buildUnifiedLearningSummary(null, null)).toMatchObject({ subjectCount: 0, activityCount: 0,
      previousLearning: { activityCount: 0 } });
  });
});
