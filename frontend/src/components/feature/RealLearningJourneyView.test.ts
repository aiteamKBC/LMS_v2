import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { JourneyComponent, JourneyModule } from '@/utils/learnerJourney';
import { buildStations } from './RealLearningJourneyView';

function component(overrides: Partial<JourneyComponent> = {}): JourneyComponent {
  return {
    title: 'Activity',
    expectedOtjh: 1,
    componentId: 'COMP-1',
    type: 'reading',
    contentHtml: '<p>Content</p>',
    ...overrides,
  };
}

function journey(components: JourneyComponent[]): JourneyModule[] {
  return [{ module: 'Module 1', weeks: [{ week: 'Week 1', otjh: 1, components }] }];
}

function detail(overrides: Partial<LearnerDetail> = {}): LearnerDetail {
  return {
    quizAttempts: [],
    videoProgress: [],
    componentProgress: [],
    ...overrides,
  } as LearnerDetail;
}

describe('buildStations progress continuity', () => {
  it('counts an imported completion and a later direct completion only once', () => {
    const real = detail({
      componentProgress: [
        { componentId: 'COMP-1', kind: 'component', componentType: 'reading', startedAt: null, submittedAt: '2025-01-01T09:00:00Z', timeTaken: null },
        { componentId: 'COMP-1', kind: 'component', componentType: 'reading', startedAt: null, submittedAt: '2026-09-10T09:00:00Z', timeTaken: null },
      ],
    });

    const result = buildStations(journey([component()]), real);

    expect(result.stations[0].trackableDone).toBe(1);
    expect(result.stations[0].trackableTotal).toBe(1);
    expect(result.overallPct).toBe(100);
  });

  it('keeps a quiz complete when a passed imported attempt is followed by a failed retake', () => {
    const quiz = component({
      componentId: 'QUIZ-COMP-1',
      type: 'quiz',
      isQuiz: true,
      quizMeta: { quizId: 7, questions: 2, duration: 10, timeUnit: 'minutes' },
      quizAttempts: [
        { quizId: 7, grade: 0.9, passed: true, startedAt: '', submittedAt: '' },
        { quizId: 7, grade: 0.4, passed: false, startedAt: '', submittedAt: '' },
      ],
    });

    const result = buildStations(journey([quiz]), detail());

    expect(result.stations[0].quizTaken).toBe(1);
    expect(result.stations[0].quizPassed).toBe(1);
    expect(result.stations[0].trackableDone).toBe(1);
    expect(result.overallPct).toBe(100);
  });

  it('does not turn a failed quiz attempt into completed progress', () => {
    const quiz = component({
      componentId: 'QUIZ-COMP-1',
      type: 'quiz',
      isQuiz: true,
      quizMeta: { quizId: 7, questions: 2, duration: 10, timeUnit: 'minutes' },
      quizAttempts: [
        { quizId: 7, grade: 0.4, passed: false, startedAt: '', submittedAt: '' },
      ],
    });

    const result = buildStations(journey([quiz]), detail());

    expect(result.stations[0].quizTaken).toBe(1);
    expect(result.stations[0].quizPassed).toBe(0);
    expect(result.stations[0].trackableDone).toBe(0);
    expect(result.overallPct).toBe(0);
  });
});
