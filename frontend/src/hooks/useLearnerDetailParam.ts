import { useCallback, useEffect, useState } from 'react';
import { fetchLearnerDetail, invalidateLearnerDetailCache, type LearnerDetail, type LearnerKind } from '@/api/learnerDetail';

/**
 * Shared real-vs-mock data hook for learner self-view and staff drill-down
 * pages. Progress-changing API calls invalidate the shared cache themselves,
 * so ordinary sidebar navigation can reuse the short-lived cached payload.
 */
export function useLearnerDetailParam(kind: string | undefined, id: string | undefined, refreshOnFocus = false) {
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const identity = isRealMode && id ? `${kind}:${id}` : null;
  const [state, setState] = useState<{
    identity: string; real: LearnerDetail | null; loading: boolean; loadError: string | null;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    if (isRealMode && id) invalidateLearnerDetailCache(kind as LearnerKind, id);
    setRefreshTick((tick) => tick + 1);
  }, [isRealMode, kind, id]);

  useEffect(() => {
    if (!refreshOnFocus || !identity) return;
    // Returning from Module Builder must pick up assignments and newly added
    // content. Browsers can emit both visibilitychange and focus together.
    let lastRefresh = 0;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now();
      refresh();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refreshOnFocus, identity, refresh]);

  useEffect(() => {
    if (!isRealMode || !id || !identity) return;
    let cancelled = false;
    setState((previous) => ({ identity, real: previous?.identity === identity ? previous.real : null, loading: true, loadError: null }));
    fetchLearnerDetail(kind as LearnerKind, id)
      .then((data) => { if (!cancelled) setState({ identity, real: data, loading: false, loadError: null }); })
      .catch((error) => {
        if (!cancelled) setState((previous) => ({ identity, real: previous?.identity === identity ? previous.real : null, loading: false, loadError: error instanceof Error ? error.message : 'Could not load learner' }));
      });
    return () => { cancelled = true; };
  }, [isRealMode, kind, id, identity, refreshTick]);

  // Staff can move directly between View pages. Hide the previous learner in
  // the first render of the new URL, before the next request effect runs.
  const current = identity && state?.identity === identity ? state : null;
  return { isRealMode, real: current?.real ?? null, loading: current?.loading ?? isRealMode, loadError: current?.loadError ?? null, refresh };
}
