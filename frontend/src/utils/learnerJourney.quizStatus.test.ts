import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { buildLearnerJourney } from './learnerJourney';

describe('buildLearnerJourney quiz progress', () => {
  it('links a normalised text quiz id to the numeric curriculum quiz id', () => {
    const learner = {
      modules: ['Module 1'],
      week: [{ module: 'Module 1', week: 'Week 1' }],
      components: [{
        module: 'Module 1',
        week: 'Week 1',
        component: 'Knowledge check',
        isQuiz: true,
        quizMeta: { quizId: 42, questions: 5 },
      }],
      quizAttempts: [{
        kind: 'quiz',
        quizId: '42',
        grade: 0.8,
        passed: true,
        startedAt: '2026-07-27T08:00:00Z',
        submittedAt: '2026-07-27T08:05:00Z',
      }],
      videoProgress: [],
    } as unknown as LearnerDetail;

    const [attempt] = buildLearnerJourney(learner)[0].weeks[0].components[0].quizAttempts ?? [];

    expect(attempt).toMatchObject({ quizId: '42', grade: 0.8, passed: true });
  });

  it('excludes quiz hours from planned week OTJH without removing quiz duration data', () => {
    const learner = {
      modules: ['Module 1'],
      week: [{ module: 'Module 1', week: 'Week 1' }],
      components: [
        {
          module: 'Module 1', week: 'Week 1', component: 'Reading',
          componentId: 'reading-1', type: 'reading', expectedOtjh: 2,
        },
        {
          module: 'Module 1', week: 'Week 1', component: 'Knowledge check',
          componentId: 'quiz-1', type: 'quiz', expectedOtjh: 0.5, isQuiz: true,
          quizMeta: { quizId: 42, questions: 5, duration: 30, timeUnit: 'minutes' },
        },
      ],
      quizAttempts: [],
      videoProgress: [],
    } as unknown as LearnerDetail;

    const week = buildLearnerJourney(learner)[0].weeks[0];

    expect(week.otjh).toBe(2);
    expect(week.components[1]).toMatchObject({
      expectedOtjh: 0.5,
      quizMeta: { duration: 30, timeUnit: 'minutes' },
    });
  });
});
