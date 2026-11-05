import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { monthlyActivities } from './monthlyActivities';

const detail = (value: Partial<LearnerDetail>) => value as LearnerDetail;
const progress = (value: object) => ({ kind: 'component' as const, componentType: 'reading', componentId: 'reading', componentTitle: 'Completed reading', submittedAt: '2026-10-12T10:00:00Z', startedAt: null, timeTaken: null, feedback: 'Full reading reflection', ksbs: ['K1'], ...value });

it('uses completed records even without feed metadata, retaining time, KSBs and reflection', () => {
  const source = detail({ activityFeed: [], componentProgress: [progress({ reportedTime: '30 minutes', timeTrackingSource: 'timer' })] });
  const before = JSON.stringify(source);
  expect(monthlyActivities(source, '2026-10')).toEqual([{ title: 'Completed reading', date: '2026-10-12', result: 'Completed', reflection: 'Full reading reflection', ksbs: ['K1'], time: '30 minutes', source: 'timer' }]);
  expect(JSON.stringify(source)).toBe(before);
  expect(monthlyActivities(source, '2026-09')).toEqual([]);
  expect(monthlyActivities(detail({}), '2026-10')).toEqual([]);
});

it('matches equivalent timestamps without duplicating feed rows or mixing two component placements', () => {
  const source = detail({ componentProgress: [progress({}), progress({ componentId: 'second', feedback: 'Second reflection' })], activityFeed: [
    { kind: 'component', componentId: 'reading', title: 'Reading title', action: 'Completed reading', at: '2026-10-12T11:00:00+01:00' },
    { kind: 'component', componentId: 'second', title: 'Second title', action: 'Completed', at: '2026-10-12T10:00:00.000Z' },
  ] });
  expect(monthlyActivities(source, '2026-10').map(a => [a.title, a.reflection])).toEqual([['Reading title', 'Full reading reflection'], ['Second title', 'Second reflection']]);
});

it('excludes unfinished records, failed attempts and other months; uses the UK month boundary', () => {
  const source = detail({ componentProgress: [progress({ submittedAt: '' }), progress({ passed: false }),
    progress({ submittedAt: '2026-09-30T23:30:00Z', componentId: 'boundary' }), progress({ submittedAt: '2026-09-29T10:00:00Z' })],
    quizAttempts: [{ quizId: 1, passed: false, grade: 0.2, startedAt: '', submittedAt: '2026-10-12T10:00:00Z' }],
    activityFeed: [{ kind: 'quiz', quizId: 1, passed: false, title: 'Failed quiz', action: 'Completed quiz', at: '2026-10-12T10:00:00Z' }],
  });
  expect(monthlyActivities(source, '2026-10')).toHaveLength(1);
  expect(monthlyActivities(source, '2026-10')[0].date).toBe('2026-10-01');
});

it('retains a passed quiz without feed entries and never uses a different quiz placement for its feedback', () => {
  const source = detail({ quizAttempts: [
    { quizId: 1, componentId: 'first', componentTitle: 'First quiz', passed: true, grade: 1, startedAt: '', submittedAt: '2026-10-12', feedback: 'First feedback' },
    { quizId: 1, componentId: 'second', componentTitle: 'Second quiz', passed: true, grade: 1, startedAt: '', submittedAt: '2026-10-12', feedback: 'Second feedback' },
  ] });
  expect(monthlyActivities(source, '2026-10').map(a => a.reflection)).toEqual(['First feedback', 'Second feedback']);
});

it('links quiz-reading feed entries to their synthetic progress IDs without duplicate activities', () => {
  const source = detail({ componentProgress: [
    progress({ kind: 'quiz_reading', componentId: 'quiz-reading:12:1', feedback: 'Reading attempt one', submittedAt: '2026-10-12T10:00:00Z' }),
    progress({ kind: 'quiz_reading', componentId: 'quiz-reading:12:2', feedback: 'Reading attempt two', submittedAt: '2026-10-13T10:00:00Z' }),
  ], activityFeed: [
    { kind: 'component', quizId: 12, title: 'Quiz preparation one', action: 'Completed reading', at: '2026-10-12T11:00:00+01:00' },
    { kind: 'component', quizId: 12, title: 'Quiz preparation two', action: 'Completed reading', at: '2026-10-13T10:00:00Z' },
  ] });
  expect(monthlyActivities(source, '2026-10').map(a => [a.title, a.reflection])).toEqual([
    ['Quiz preparation two', 'Reading attempt two'], ['Quiz preparation one', 'Reading attempt one'],
  ]);
});
