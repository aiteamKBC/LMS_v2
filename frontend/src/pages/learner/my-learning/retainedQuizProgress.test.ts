import { describe, expect, it } from 'vitest';
import type { LearnerComponentEntry, LearnerDetail, LearnerQuizAttempt } from '@/api/learnerDetail';
import { buildLinkedQuizzes } from '@/utils/linkedQuizzes';
import { quizAttemptsFor } from '@/utils/learnerJourney';
import { buildUnifiedLearningSummary } from './learningSummary';

const quiz = (componentId: string, quizId: number, extra: Partial<LearnerComponentEntry> = {}): LearnerComponentEntry => ({
  module: 'Module A', week: 'Week 2', component: `Quiz ${componentId}`, expectedOtjh: null, moduleId: 'MOD-A', weekId: 'WEEK-2',
  componentId, type: 'quiz', isQuiz: true, quizMeta: { quizId, questions: 10, duration: null, timeUnit: null }, ...extra,
});
const attempt = (quizId: number, passed: boolean, componentId: string | null = null): LearnerQuizAttempt => ({
  kind: 'quiz', quizId, passed, grade: passed ? 0.9 : 0.2, componentId, startedAt: '2026-09-25T10:00:00Z', submittedAt: '2026-09-25T10:30:00Z',
});
const learner = (extra: Partial<LearnerDetail>): LearnerDetail => ({
  components: [quiz('COMP-1', 200), quiz('COMP-2', 201)], quizAttempts: [], modules: ['Module A'],
  ...extra,
} as LearnerDetail);
const moduleA = (real: LearnerDetail) => buildUnifiedLearningSummary(null, real).subjects.find(subject => subject.id === 'current:MOD-A')!;

describe('quiz results earned before an author changed the module', () => {
  it('credits an attempt the server traced to a component that now links a different quiz', () => {
    const real = learner({ quizAttempts: [attempt(100, true, 'COMP-1')] });
    const subject = moduleA(real);

    expect(subject.activities.map(entry => [entry.id, entry.completed])).toEqual([['COMP-1', true], ['COMP-2', false]]);
    expect(subject.activities[0].bestScorePercent).toBe(90);
    expect(buildLinkedQuizzes(real).find(item => item.quizId === 200)?.attempts).toHaveLength(1);
  });

  it('keeps a passed quiz whose slot was removed as completed work in its module', () => {
    const retired = quiz('COMP-OLD', 99, { component: 'Removed quiz', retired: true, quizMeta: { quizId: 99, questions: null, duration: null, timeUnit: null } });
    const summary = buildUnifiedLearningSummary(null, learner({ quizAttempts: [attempt(99, true)], retiredQuizComponents: [retired] }));
    const subject = summary.subjects.find(item => item.id === 'current:MOD-A')!;

    expect(subject.activities.map(entry => [entry.id, entry.completed, entry.native?.retired ?? false]))
      .toEqual([['COMP-1', false, false], ['COMP-2', false, false], ['COMP-OLD', true, true]]);
    expect([summary.activityCount, summary.completedActivityCount]).toEqual([3, 1]);
  });

  it('does not credit an unrelated attempt or an attempt traced to another component', () => {
    expect(quizAttemptsFor(quiz('COMP-1', 200), [attempt(300, true), attempt(100, true, 'COMP-2')])).toEqual([]);
    expect(moduleA(learner({ quizAttempts: [attempt(300, true)] })).activities.every(entry => !entry.completed)).toBe(true);
  });
});
