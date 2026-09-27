import { describe, expect, it } from 'vitest';
import { applyEngagementStudentStatuses, normalizeStudentStatus } from './caseloadSelectors';
import type { CaseloadApiLearner } from '../types/caseload.types';

const learner = (id: string, enrolmentId: string | null, name: string): CaseloadApiLearner => ({
  id, enrolmentId, name, initials: name.slice(0, 2), employer: '--', cohortId: '', cohortName: '', group: '',
  status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 0,
  attendanceRate: 0, otjhCompleted: 0, otjhTarget: 0, ksbProgress: null,
  evidenceCount: 0, nextCoaching: '--', nextReview: '--', lastContact: '--', lastAttendanceDate: '--',
  lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--', lastSubmittedEvidence: '--', recentFlag: null,
});

describe('Caseload Student Status contract', () => {
  it.each([
    ['new starter', 'new-starter'], ['at_risk', 'at-risk'], ['HIGH', 'high'], ['on-track', 'on-track'],
  ])('normalizes the allowed status %s', (input, expected) => {
    expect(normalizeStudentStatus(input)).toBe(expected);
  });

  it('joins strictly by enrolmentId and leaves unmatched learners unavailable', () => {
    const result = applyEngagementStudentStatuses(
      [learner('profile-1', 'enrolment-7', 'Same Name'), learner('profile-2', 'enrolment-8', 'Same Name')],
      [{ id: 'enrolment-7', overallStatus: 'at-risk' }, { id: 'profile-2', overallStatus: 'high' }],
    );
    expect(result.map(({ status }) => status)).toEqual(['at-risk', 'unavailable']);
  });

  it('does not invent a status for missing or unsupported analytics values', () => {
    expect(applyEngagementStudentStatuses(
      [learner('profile-1', null, 'Learner'), learner('profile-2', '2', 'Learner')],
      [{ id: '2', overallStatus: 'needs-attention' }],
    ).map(({ status }) => status)).toEqual(['unavailable', 'unavailable']);
  });
});
