import { describe, expect, it } from 'vitest';
import { markingActivityLabel, markingStatusLabel, markingSubmissionPreview } from './markingSelectors';
import type { MarkingSubmission } from '../types/marking.types';

const submission = (overrides: Partial<MarkingSubmission> = {}) => ({
  id: '1', learner: 'Learner', programme: 'Programme', activityType: '', activityTitle: '', module: '', week: '',
  status: 'submitted_for_tutor_review', learningReflection: '', ksbCodes: [], applicationText: '', benefitExplanation: '',
  qualityScore: 0, coachFeedback: null, reviewedBy: null, submittedDisplay: '', elapsedDays: 0, isOverdue: false,
  ...overrides,
});

describe('Marking presentation contract', () => {
  it.each([
    ['accepted', false, 'Accepted'], ['partial', false, 'Partially awarded'],
    ['referred', false, 'Referred back'], ['rejected', false, 'Referred back'],
    ['escalated', false, 'Escalated'], ['submitted_for_tutor_review', false, 'Pending'],
    ['accepted', true, 'Overdue'],
  ] as const)('keeps %s status label', (status, overdue, expected) => {
    expect(markingStatusLabel(status, overdue)).toBe(expected);
  });

  it('preserves reflection, application and benefit preview precedence', () => {
    expect(markingSubmissionPreview(submission({ learningReflection: 'Reflection', applicationText: 'Application' }))).toBe('Reflection');
    expect(markingSubmissionPreview(submission({ applicationText: 'Application', benefitExplanation: 'Benefit' }))).toBe('Application');
    expect(markingSubmissionPreview(submission({ benefitExplanation: 'Benefit' }))).toBe('Benefit');
  });

  it('uses existing activity labels without status reinterpretation', () => {
    expect(markingActivityLabel(submission({ activityType: 'extra_activity' }), 'assignment')).toBe('extra activity');
    expect(markingActivityLabel(submission(), 'assignment')).toBe('Assignment');
  });
});
