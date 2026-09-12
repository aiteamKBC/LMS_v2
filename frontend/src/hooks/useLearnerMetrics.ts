import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerMetrics, peekLearnerMetrics } from '@/api/learnerMetrics';
import { useLiveLearnerRead } from './useLiveLearnerRead';

export function useLearnerMetrics(kind?: LearnerKind | null, id?: string | null, enabled = true) {
  return useLiveLearnerRead(kind, id, enabled, fetchLearnerMetrics, peekLearnerMetrics);
}
