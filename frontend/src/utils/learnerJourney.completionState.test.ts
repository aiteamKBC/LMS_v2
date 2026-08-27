import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { completedComponentIds, isComponentComplete, type JourneyComponent } from './learnerJourney';

const component = (over: Partial<JourneyComponent>): JourneyComponent => ({
  title: 'Reading Material 2',
  expectedOtjh: null,
  componentId: 'comp-1',
  type: 'reading',
  ...over,
});

describe('isComponentComplete', () => {
  it('marks a component the learner has a recorded completion for', () => {
    const done = completedComponentIds({
      videoProgress: [],
      componentProgress: [{ componentId: 'comp-1', kind: 'reading' }],
    });

    expect(isComponentComplete(component({}), done)).toBe(true);
    expect(isComponentComplete(component({ componentId: 'comp-2' }), done)).toBe(false);
  });

  it('leaves a component with no completion record outstanding', () => {
    expect(isComponentComplete(component({}), new Set())).toBe(false);
  });

  it('ignores a component progress row recorded as not passed', () => {
    const done = completedComponentIds({
      videoProgress: [],
      componentProgress: [{ componentId: 'comp-1', kind: 'assignment', passed: false }],
    });

    expect(isComponentComplete(component({ type: 'assignment' }), done)).toBe(false);
  });

  it('counts a quiz as complete from a passed attempt, not from its id', () => {
    const quiz = component({
      componentId: null,
      isQuiz: true,
      quizMeta: { quizId: 7, questions: 5 },
      quizAttempts: [{ grade: 0.9, passed: true }],
    } as Partial<JourneyComponent>);

    expect(isComponentComplete(quiz, new Set())).toBe(true);
  });

  it('keeps a passed quiz complete after a later failed retake', () => {
    const quiz = component({
      componentId: null,
      isQuiz: true,
      quizAttempts: [{ grade: 0.9, passed: true }, { grade: 0.2, passed: false }],
    } as Partial<JourneyComponent>);

    expect(isComponentComplete(quiz, new Set())).toBe(true);
  });

  it('leaves a quiz with only failed attempts outstanding', () => {
    const quiz = component({
      componentId: null,
      isQuiz: true,
      quizAttempts: [{ grade: 0.2, passed: false }],
    } as Partial<JourneyComponent>);

    expect(isComponentComplete(quiz, new Set())).toBe(false);
  });

  it('de-duplicates a component completed from both progress sources', () => {
    const detail = {
      videoProgress: [{ componentId: 'vid-1', kind: 'video' }],
      componentProgress: [{ componentId: 'vid-1', kind: 'video' }],
    } as unknown as LearnerDetail;

    expect(completedComponentIds(detail).size).toBe(1);
  });
});
