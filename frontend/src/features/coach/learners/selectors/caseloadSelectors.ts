import type { CaseloadApiLearner, EngagementLearnerStatus } from '../types/caseload.types';

const STUDENT_STATUSES = new Set(['new-starter', 'at-risk', 'high', 'on-track']);

export function normalizeStudentStatus(value: unknown): CaseloadApiLearner['status'] {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return STUDENT_STATUSES.has(normalized)
    ? normalized as CaseloadApiLearner['status']
    : 'unavailable';
}

/** Join only on the stable Created_users/enrolment identity. */
export function applyEngagementStudentStatuses(
  learners: CaseloadApiLearner[],
  analytics: EngagementLearnerStatus[],
): CaseloadApiLearner[] {
  const statusByEnrolmentId = new Map(
    analytics.map((row) => [String(row.id), normalizeStudentStatus(row.overallStatus)]),
  );
  return learners.map((learner) => ({
    ...learner,
    status: learner.enrolmentId == null
      ? 'unavailable'
      : statusByEnrolmentId.get(String(learner.enrolmentId)) ?? 'unavailable',
  }));
}
