import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { trainingPlanWeekPosition } from './learnerJourney';

function learner(startDate: string): LearnerDetail {
  return {
    programmeStartDate: startDate,
    modules: ['Module 1', 'Module 2'],
    week: [
      { module: 'Module 1', week: 'Week 1' },
      { module: 'Module 1', week: 'Week 2' },
      { module: 'Module 2', week: 'Week 1' },
      { module: 'Module 2', week: 'Week 2' },
    ],
    components: [],
    quizAttempts: [],
  } as unknown as LearnerDetail;
}

describe('trainingPlanWeekPosition', () => {
  it('counts the current week across all module weeks', () => {
    expect(trainingPlanWeekPosition(learner('2026-08-03'), new Date(2026, 7, 17))).toEqual({
      current: 3,
      total: 4,
      state: 'active',
    });
  });

  it('reports an upcoming plan before its start date', () => {
    expect(trainingPlanWeekPosition(learner('2026-08-03'), new Date(2026, 7, 1))).toEqual({
      current: null,
      total: 4,
      state: 'upcoming',
    });
  });

  it('caps the current week when the plan has finished', () => {
    expect(trainingPlanWeekPosition(learner('2026-08-03'), new Date(2026, 8, 1))).toEqual({
      current: 4,
      total: 4,
      state: 'complete',
    });
  });
});
