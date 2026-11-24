import { expect, it } from 'vitest';
import { completedComponentIds, isComponentComplete, recordedKsbEvidenceCodes, type JourneyComponent } from './learnerJourney';
import type { LearnerDetail, LiveSessionLearning } from '@/api/learnerDetail';
import { canonicalActivityRows } from '@/pages/workspace/learner/weeklyPlanPresentation';
import type { CanonicalSelectedWeek } from '@/api/weeklyLearning';

it.each<LiveSessionLearning['status']>(['reflection-required', 'awaiting-review', 'evidence-required',
  'submission-required', 'changes-required', 'completed'])('completes attendance while retaining %s follow-up in student detail and weekly rows', status => {
  const learning: LiveSessionLearning = { status: 'completed', requirementsStatus: status, attendance: 'present', attendedSeconds: 7200, attendedAt: null };
  const component: JourneyComponent = { title: 'Synthetic lecture', componentId: 'C1', type: 'live_session',
    expectedOtjh: 2.5, attendanceCompleted: true, liveSessionLearning: learning };
  expect(isComponentComplete(component, new Set())).toBe(true);
  const ids = completedComponentIds({ componentProgress: [{ componentId: 'C1', kind: 'component',
    passed: null, completionEligible: true }] });
  expect(ids.has('C1')).toBe(true);
  const rows = canonicalActivityRows({ activities: [{ id: 'C1', title: 'Synthetic lecture', type: 'live_session',
    status: 'completed', liveSessionLearning: learning,
    isQuiz: false, expectedHours: 2.5, actualHours: 2.5, durationMinutes: 120,
    quizDuration: null, quizTimeUnit: null, ksbCodes: [] }] } as CanonicalSelectedWeek);
  expect(rows[0].liveSessionLearning).toEqual(learning);
  expect(isComponentComplete(rows[0], ids)).toBe(true);
});

it('preserves historical manual completion without claiming attendance', () => {
  const ids = completedComponentIds({ componentProgress: [{ componentId: 'C1', kind: 'component', passed: null }] });
  expect(isComponentComplete({ title: 'Lecture', expectedOtjh: 2, type: 'live_session', componentId: 'C1' }, ids)).toBe(true);
});

it('keeps stored KSB evidence while required lecture work is outstanding', () => {
  const detail = { componentProgress: [{ componentId: 'C1', kind: 'component', passed: null,
    completionEligible: false, ksbs: ['K1'] }, { componentId: 'C2', kind: 'component', passed: false,
    ksbs: ['K2'] }] } as LearnerDetail;
  expect(completedComponentIds(detail).has('C1')).toBe(false);
  expect([...recordedKsbEvidenceCodes(detail)]).toEqual(['K1']);
});
