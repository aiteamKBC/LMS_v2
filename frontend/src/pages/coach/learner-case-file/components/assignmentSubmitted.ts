import type { MonthlyAssignmentRow } from '@/pages/learner/monthly-submission/model';

/** Not submitted yet: nothing to open, so these stay off the coach's list. */
const UNSUBMITTED = new Set(['', 'todo', 'draft']);

/** Submitted at least once — including work sent back for changes. */
export function hasSubmission(row: Pick<MonthlyAssignmentRow, 'status' | 'submissionCount'>): boolean {
  return (row.submissionCount ?? 0) > 0 || !UNSUBMITTED.has(row.status);
}
