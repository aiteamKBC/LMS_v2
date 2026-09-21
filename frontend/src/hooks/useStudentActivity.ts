import type { LearnerKind } from '@/api/learnerDetail';
import { fetchStudentActivity, peekStudentActivity } from '@/api/studentActivity';
import { useLiveLearnerRead } from './useLiveLearnerRead';

/** One owner for the historical activity request, cache, retry and save refresh. */
export function useStudentActivity(kind?: LearnerKind | null, id?: string | null, enabled = true) {
  return useLiveLearnerRead(kind, id, enabled, fetchStudentActivity, peekStudentActivity);
}
