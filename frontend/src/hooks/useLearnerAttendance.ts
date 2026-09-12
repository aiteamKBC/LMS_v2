import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerAttendance, peekLearnerAttendance } from '@/api/learnerAttendance';
import { useLiveLearnerRead } from './useLiveLearnerRead';

export function useLearnerAttendance(kind?: LearnerKind | null, id?: string | null, enabled = true) {
  return useLiveLearnerRead(kind, id, enabled, fetchLearnerAttendance, peekLearnerAttendance);
}
