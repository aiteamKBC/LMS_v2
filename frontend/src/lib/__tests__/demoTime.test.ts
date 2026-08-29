import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JourneyComponent } from '@/utils/learnerJourney';
import {
  actualMinutesFor,
  buildDemoTimings,
  demoCompletionState,
  demoTimeKey,
  expectedMinutesFor,
  formatDemoMinutes,
  getDemoTimeOverride,
  setDemoTimeOverride,
  summariseDemoTimings,
} from '../demoTime';

function component(overrides: Partial<JourneyComponent> = {}): JourneyComponent {
  return {
    title: 'Reading · Intro',
    expectedOtjh: null,
    type: 'reading',
    componentId: 'comp-1',
    ...overrides,
  };
}

describe('demoTime', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('expectedMinutesFor', () => {
    it('prefers expectedOtjh, converted to minutes', () => {
      expect(expectedMinutesFor({ expectedOtjh: 1.5, durationMinutes: null, quizMeta: undefined })).toBe(90);
    });
    it('falls back to durationMinutes', () => {
      expect(expectedMinutesFor({ expectedOtjh: null, durationMinutes: 20, quizMeta: undefined })).toBe(20);
    });
    it('falls back to a quiz time limit', () => {
      expect(expectedMinutesFor({ expectedOtjh: null, durationMinutes: null, quizMeta: { quizId: 1, questions: 5, duration: 30, timeUnit: 'minutes' } })).toBe(30);
    });
    it('converts an hours-unit quiz limit', () => {
      expect(expectedMinutesFor({ expectedOtjh: null, durationMinutes: null, quizMeta: { quizId: 1, questions: 5, duration: 1, timeUnit: 'hours' } })).toBe(60);
    });
    it('is null when nothing is authored', () => {
      expect(expectedMinutesFor({ expectedOtjh: null, durationMinutes: null, quizMeta: undefined })).toBeNull();
    });
  });

  describe('actualMinutesFor', () => {
    it('prefers the auto-tracked clock', () => {
      expect(actualMinutesFor({ timeTaken: '01:30', reportedTime: '45 minutes' })).toBe(1.5);
    });
    it('falls back to the free-text reported time', () => {
      expect(actualMinutesFor({ timeTaken: null, reportedTime: 'about 25 minutes' })).toBe(25);
    });
    it('is null with no record', () => {
      expect(actualMinutesFor(null)).toBeNull();
    });
  });

  it('formatDemoMinutes renders hours/minutes and a dash for unknown', () => {
    expect(formatDemoMinutes(90)).toBe('1h 30m');
    expect(formatDemoMinutes(null)).toBe('—');
  });

  it('demoTimeKey names a quiz and a component distinctly', () => {
    expect(demoTimeKey({ isQuiz: true, quizId: 17 })).toBe('quiz-17');
    expect(demoTimeKey({ isQuiz: false, componentId: 'comp-1' })).toBe('comp-1');
  });

  describe('demoCompletionState', () => {
    it('a passed quiz is completed', () => {
      const c = component({ isQuiz: true, quizAttempts: [{ passed: true } as never] });
      expect(demoCompletionState(c, new Set())).toBe('completed');
    });
    it('an attempted-not-passed quiz is in progress', () => {
      const c = component({ isQuiz: true, quizAttempts: [{ passed: false } as never] });
      expect(demoCompletionState(c, new Set())).toBe('in-progress');
    });
    it('a completed non-quiz component reads from completedIds', () => {
      const c = component({ componentId: 'comp-9' });
      expect(demoCompletionState(c, new Set(['comp-9']))).toBe('completed');
      expect(demoCompletionState(c, new Set())).toBe('not-started');
    });
  });

  describe('overrides', () => {
    it('round-trips through storage and clears on null', () => {
      expect(getDemoTimeOverride('apprenticeship:1', 'comp-1')).toBeNull();
      setDemoTimeOverride('apprenticeship:1', 'comp-1', 38);
      expect(getDemoTimeOverride('apprenticeship:1', 'comp-1')).toBe(38);
      setDemoTimeOverride('apprenticeship:1', 'comp-1', null);
      expect(getDemoTimeOverride('apprenticeship:1', 'comp-1')).toBeNull();
    });

    it('is scoped per learner', () => {
      setDemoTimeOverride('apprenticeship:1', 'comp-1', 10);
      expect(getDemoTimeOverride('apprenticeship:2', 'comp-1')).toBeNull();
    });
  });

  describe('buildDemoTimings + summariseDemoTimings', () => {
    it('sums totals from component-level rows, never a single stored total', () => {
      const components: JourneyComponent[] = [
        component({ componentId: 'c1', description: 'x', expectedOtjh: 0.5 }),
        component({ componentId: 'c2', description: 'x', expectedOtjh: 0.5, type: 'video', videoUrl: 'https://example.com/v.mp4' }),
        component({
          title: 'Quiz · Checkpoint', isQuiz: true, componentId: undefined, expectedOtjh: null,
          quizMeta: { quizId: 9, questions: 3, duration: 10, timeUnit: 'minutes' },
        }),
      ];
      const completions = [{ kind: 'component' as const, componentType: 'reading', componentId: 'c1', reportedTime: '25 minutes', startedAt: null, submittedAt: '', timeTaken: null }];
      const videos = [{ kind: 'video' as const, componentId: 'c2', reportedTime: '30 minutes', startedAt: null, submittedAt: '', timeTaken: '00:20' }];
      const completedIds = new Set(['c1', 'c2']);

      const timings = buildDemoTimings(components, videos, completions, completedIds, {});
      expect(timings).toHaveLength(3);

      const summary = summariseDemoTimings(timings);
      expect(summary.materialsTotal).toBe(3);
      expect(summary.materialsCompleted).toBe(2);
      expect(summary.expectedMinutes).toBe(30 + 30 + 10);
      // c1 completed at its reported 25min, c2 completed at its 20s clock
      // reading (rounded to one decimal place by parseClockMinutes: 0.3).
      expect(summary.completedMinutes).toBeCloseTo(25.3, 1);
      expect(summary.quizzesTotal).toBe(1);
      expect(summary.quizzesPassed).toBe(0);
    });

    it('an override wins over the recorded time', () => {
      const components: JourneyComponent[] = [component({ componentId: 'c1', description: 'x', expectedOtjh: 0.5 })];
      const completions = [{ kind: 'component' as const, componentType: 'reading', componentId: 'c1', reportedTime: '25 minutes', startedAt: null, submittedAt: '', timeTaken: null }];
      const timings = buildDemoTimings(components, [], completions, new Set(['c1']), { c1: 38 });
      expect(timings[0].actualMinutes).toBe(38);
      expect(timings[0].recordedMinutes).toBe(25);
      expect(timings[0].overridden).toBe(true);
    });
  });
});
