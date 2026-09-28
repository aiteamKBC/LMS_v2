import type { MarkingSubmission } from '../types/marking.types';
import type { MarkingKind } from '@/lib/markingKind';

export function markingStatusLabel(status: string, isOverdue = false) {
  if (isOverdue) return 'Overdue';
  if (status === 'accepted') return 'Accepted';
  if (status === 'partial') return 'Partially awarded';
  if (status === 'referred' || status === 'rejected') return 'Referred back';
  if (status === 'escalated') return 'Escalated';
  return 'Pending';
}

export function markingSubmissionPreview(item: MarkingSubmission) {
  return item.learningReflection || item.applicationText || item.benefitExplanation
    || 'Open the submission to review the learner evidence and recorded KSBs.';
}

export function markingActivityLabel(item: MarkingSubmission, kind: MarkingKind) {
  if (item.activityType) return item.activityType.replaceAll('_', ' ');
  return kind === 'assignment' ? 'Assignment' : 'Learning reflection';
}

