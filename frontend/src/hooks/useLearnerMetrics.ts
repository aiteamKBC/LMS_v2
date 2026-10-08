import { useCallback } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerMetrics, peekLearnerMetrics } from '@/api/learnerMetrics';
import { useLiveLearnerRead } from './useLiveLearnerRead';

export function useLearnerMetrics(kind?: LearnerKind | null, id?: string | null, enabled = true, perspective?: 'learner-overview') {
  const read = useCallback((readKind: LearnerKind, readId: string, signal?: AbortSignal, force = false) =>
    fetchLearnerMetrics(readKind, readId, signal, force, perspective), [perspective]);
  const peek = useCallback((readKind: LearnerKind, readId: string) =>
    peekLearnerMetrics(readKind, readId, perspective), [perspective]);
  return useLiveLearnerRead(kind, id, enabled, read, peek);
}
