import { useCallback, useEffect, useState } from 'react';
import { fetchLearnerDetail, invalidateLearnerDetailCache, type LearnerDetail, type LearnerKind } from '@/api/learnerDetail';

/**
 * Shared real-vs-mock data hook for learner self-view and staff drill-down
 * pages. Progress-changing API calls invalidate the shared cache themselves,
 * so ordinary sidebar navigation can reuse the short-lived cached payload.
 */
export function useLearnerDetailParam(kind: string | undefined, id: string | undefined) {
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const [real, setReal] = useState<LearnerDetail | null>(null);
  const [loading, setLoading] = useState(isRealMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    if (isRealMode && id) invalidateLearnerDetailCache(kind as LearnerKind, id);
    setRefreshTick((tick) => tick + 1);
  }, [isRealMode, kind, id]);

  useEffect(() => {
    if (!isRealMode || !id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchLearnerDetail(kind as LearnerKind, id)
      .then((data) => { if (!cancelled) setReal(data); })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load learner');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isRealMode, kind, id, refreshTick]);

  return { isRealMode, real, loading, loadError, refresh };
}
