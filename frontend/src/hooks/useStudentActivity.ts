import type { LearnerKind } from '@/api/learnerDetail';
import { useCallback } from 'react';
import { fetchStudentActivity, peekStudentActivity } from '@/api/studentActivity';
import { useLiveLearnerRead } from './useLiveLearnerRead';

/** One owner for the historical activity request, cache, retry and save refresh. */
export function useStudentActivity(kind?: LearnerKind | null, id?: string | null, enabled = true, view?: 'my-learning') {
  const read = useCallback((readKind: LearnerKind, readId: string, signal?: AbortSignal, force = false) =>
    fetchStudentActivity(readKind, readId, signal, force, view), [view]);
  const peek = useCallback((readKind: LearnerKind, readId: string) => peekStudentActivity(readKind, readId, view), [view]);
  return useLiveLearnerRead(kind, id, enabled, read, peek);
}
