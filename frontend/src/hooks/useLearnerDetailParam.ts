import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchLearnerDetail, invalidateLearnerDetailCache, type LearnerDetail, type LearnerKind } from '@/api/learnerDetail';

/**
 * Shared real-vs-mock data hook for pages reachable both as a plain self-view
 * (no route params) and as a staff drill-down at /.../:kind/:id.
 *
 * Refetches on every navigation to the page (via location.key) so that data
 * changed elsewhere — e.g. a quiz taken on /learner/quiz/... and persisted to
 * the learner's Active_users mirror — shows up when the learner returns here,
 * rather than a stale first-load snapshot. Also exposes `refresh()` for
 * in-place refetches without navigating.
 */
export function useLearnerDetailParam(kind: string | undefined, id: string | undefined) {
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const location = useLocation();
  const [real, setReal] = useState<LearnerDetail | null>(null);
  const [loading, setLoading] = useState(isRealMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    if (isRealMode && id) invalidateLearnerDetailCache(kind as LearnerKind, id);
    setRefreshTick((t) => t + 1);
  }, [isRealMode, kind, id]);

  useEffect(() => {
    if (!isRealMode || !id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchLearnerDetail(kind as LearnerKind, id)
      .then((data) => { if (!cancelled) setReal(data); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load learner'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // location.key changes on every navigation (incl. back), forcing a refetch
    // when the learner returns from taking a quiz. refreshTick allows manual refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealMode, kind, id, location.key, refreshTick]);

  return { isRealMode, real, loading, loadError, refresh };
}
