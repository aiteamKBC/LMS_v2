import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import {
  activityActionLabel, activityExpectedTimeLabel, activityHref, activityKsbCodes, activityStatus,
  resolveInitialWeek, weekComponents, weekKey, weekProgress, weekWindow,
} from '../weeklyPlanHelpers';

function session(slotNumber: number, date: string, extra: Partial<Extract<CurriculumRow, { kind: 'session' }>> = {}): CurriculumRow {
  return { kind: 'session', slotNumber, date, sessionNumber: slotNumber, title: `Session ${slotNumber}`,
    start: null, minutes: null, attended: null, joinUrl: null, ...extra };
}
function readingWeek(slotNumber: number, date: string): CurriculumRow {
  return { kind: 'reading-week', slotNumber, date, holidays: [] };
}

describe('weekWindow', () => {
  it('spans from a week\'s own date up to (but excluding) the next week\'s date', () => {
    const weeks = [session(1, '2026-09-07'), session(2, '2026-09-14'), session(3, '2026-09-21')];
    expect(weekWindow(weeks, 0)).toEqual({ start: '2026-09-07', end: '2026-09-13' });
    expect(weekWindow(weeks, 1)).toEqual({ start: '2026-09-14', end: '2026-09-20' });
  });
  it('leaves the last week open-ended', () => {
    const weeks = [session(1, '2026-09-07'), session(2, '2026-09-14')];
    expect(weekWindow(weeks, 1)).toEqual({ start: '2026-09-14', end: null });
  });
});

describe('resolveInitialWeek', () => {
  const weeks = [session(1, '2026-09-07'), readingWeek(2, '2026-09-14'), session(3, '2026-09-21')];

  it('picks the week covering today first', () => {
    expect(resolveInitialWeek(weeks, '2026-09-16')).toBe(weeks[1]);
    expect(resolveInitialWeek(weeks, '2026-09-08')).toBe(weeks[0]);
  });
  it('falls back to the next upcoming week when today falls in a gap before the plan starts', () => {
    expect(resolveInitialWeek(weeks, '2026-09-01')).toBe(weeks[0]);
  });
  it('falls back to the first week once every week is in the past', () => {
    expect(resolveInitialWeek(weeks, '2027-01-01')).toBe(weeks[2]);
  });
  it('is undefined for an empty plan', () => {
    expect(resolveInitialWeek([], '2026-09-01')).toBeUndefined();
  });
});

describe('weekKey', () => {
  it('is a stable string keyed on slot number', () => {
    expect(weekKey(session(4, '2026-09-01'))).toBe('4');
  });
});

describe('weekComponents', () => {
  const real = {
    quizAttempts: [{ quizId: 9, grade: 1, passed: true, startedAt: '', submittedAt: '' }],
    components: [
      { module: 'Marketing', week: 'Week 1', component: 'Intro reading', moduleId: 'M1', weekId: 'W1', type: 'reading', componentId: 'C1' },
      { module: 'Marketing', week: 'Week 1', component: 'Intro quiz', moduleId: 'M1', weekId: 'W1', type: 'quiz', componentId: 'C2', isQuiz: true, quizMeta: { quizId: 9, questions: 5, duration: 10, timeUnit: 'mins' } },
      { module: 'Marketing', week: 'Week 2', component: 'Other week reading', moduleId: 'M1', weekId: 'W2', type: 'reading', componentId: 'C3' },
      { module: 'Other module', week: 'Week 1', component: 'Different module', moduleId: 'M2', weekId: 'W1', type: 'reading', componentId: 'C4' },
    ],
  } as unknown as LearnerDetail;

  it('keeps only the components authored for this module and week id', () => {
    const components = weekComponents(real, 'M1', 'W1');
    expect(components.map(c => c.componentId)).toEqual(['C1', 'C2']);
  });
  it('attaches the quiz\'s own attempts by quiz id', () => {
    const [, quiz] = weekComponents(real, 'M1', 'W1');
    expect(quiz.quizAttempts).toHaveLength(1);
    expect(quiz.quizAttempts?.[0].passed).toBe(true);
  });
  it('is empty without a resolved module, week or learner record', () => {
    expect(weekComponents(null, 'M1', 'W1')).toEqual([]);
    expect(weekComponents(real, undefined, 'W1')).toEqual([]);
    expect(weekComponents(real, 'M1', undefined)).toEqual([]);
  });
});

describe('weekProgress', () => {
  it('divides completed by total, rounded to two decimals', () => {
    const components = [{ componentId: 'C1', title: 'A' }, { componentId: 'C2', title: 'B' }, { componentId: 'C3', title: 'C' }] as any;
    expect(weekProgress(components, new Set(['C1']))).toEqual({ completed: 1, total: 3, percent: 33.33 });
  });
  it('is safely zero, not NaN, for a week with no activities', () => {
    expect(weekProgress([], new Set())).toEqual({ completed: 0, total: 0, percent: 0 });
  });
});

describe('activityStatus / activityActionLabel', () => {
  it('is completed once the component id is in the completed set', () => {
    const component = { componentId: 'C1', title: 'A' } as any;
    expect(activityStatus(component, new Set(['C1']))).toBe('completed');
    expect(activityActionLabel('completed')).toBe('View');
  });
  it('is in-progress for a quiz that has been attempted but not passed', () => {
    const component = { componentId: 'C1', title: 'Quiz', isQuiz: true, quizAttempts: [{ passed: false, grade: 0.3, startedAt: '', submittedAt: '' }] } as any;
    expect(activityStatus(component, new Set())).toBe('in-progress');
    expect(activityActionLabel('in-progress')).toBe('Continue');
  });
  it('is not-started otherwise', () => {
    const component = { componentId: 'C1', title: 'Reading' } as any;
    expect(activityStatus(component, new Set())).toBe('not-started');
    expect(activityActionLabel('not-started')).toBe('Start');
  });
});

describe('activityHref', () => {
  it('routes a quiz to the quiz runner', () => {
    const component = { componentId: 'C1', title: 'Quiz', isQuiz: true, quizMeta: { quizId: 9, questions: 5, duration: null, timeUnit: null } } as any;
    expect(activityHref(component, 'Week 1', 'commercial', '125', false)).toBe('/learner/quiz/commercial/125/9?week=Week%201');
  });
  it('is null when the component has no openable content', () => {
    const component = { componentId: 'C1', title: 'Reading', type: 'reading' } as any;
    expect(activityHref(component, 'Week 1', 'commercial', '125', false)).toBeNull();
  });
  it('falls back to the component runner for assignments', () => {
    const component = { componentId: 'A1', title: 'Assignment', type: 'assignment' } as any;
    expect(activityHref(component, 'Week 2', 'commercial', '125', true)).toBe('/learner/component/commercial/125/A1?week=Week%202');
  });
});

describe('activityExpectedTimeLabel', () => {
  it('prefers the quiz\'s own duration', () => {
    expect(activityExpectedTimeLabel({ isQuiz: true, quizMeta: { quizId: 1, questions: 5, duration: 15, timeUnit: 'mins' } } as any)).toBe('15 mins');
  });
  it('falls back to a video/session duration in minutes', () => {
    expect(activityExpectedTimeLabel({ durationMinutes: 25 } as any)).toBe('25 mins');
  });
  it('falls back to expected OTJ hours', () => {
    expect(activityExpectedTimeLabel({ expectedOtjh: 0.5 } as any)).not.toBe('—');
  });
  it('is an em dash when nothing is known', () => {
    expect(activityExpectedTimeLabel({} as any)).toBe('—');
  });
});

describe('activityKsbCodes', () => {
  it('de-duplicates mapped codes', () => {
    const component = { ksbMappings: [{ code: 'K1', description: '', classification: null, weight: 1 }, { code: 'K1', description: '', classification: null, weight: 1 }, { code: 'S2', description: '', classification: null, weight: 1 }] } as any;
    expect(activityKsbCodes(component)).toEqual(['K1', 'S2']);
  });
  it('reads KSB codes from fallback payload shapes', () => {
    const component = { ksbCodes: ['k1'], ksbs: ['S2'], ksb_mappings: [{ ksb_code: 'b3' }, 'K1'] } as any;
    expect(activityKsbCodes(component)).toEqual(['B3', 'K1', 'S2']);
  });
  it('is empty, never invented, when nothing is mapped', () => {
    expect(activityKsbCodes({} as any)).toEqual([]);
  });
});
