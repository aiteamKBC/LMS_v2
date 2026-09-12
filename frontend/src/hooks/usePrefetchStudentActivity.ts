import { useEffect } from 'react';
import { fetchLearnerSummary, type LearnerKind } from '@/api/learnerDetail';
import { fetchStudentActivity } from '@/api/studentActivity';

/** Start the historical source read alongside the full training-plan request.
 * The small summary establishes availability; the page handles any load error. */
export function usePrefetchStudentActivity(kind?: LearnerKind, id?: string) {
  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    void fetchLearnerSummary(kind, id).then(summary => {
      if (summary.studentActivityAvailable && !controller.signal.aborted) {
        return fetchStudentActivity(kind, id, controller.signal);
      }
    }).catch(() => { /* The visible data hook reports the failure and retry. */ });
    return () => controller.abort();
  }, [kind, id]);
}
