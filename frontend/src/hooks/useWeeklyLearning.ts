import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';
import { fetchWeeklyLearning, peekWeeklyLearning, primeWeeklyLearningWeek, fetchWeeklyLearningWeek, peekWeeklyLearningWeek, type WeeklyLearningDetail, type WeeklyLearningWeek } from '@/api/weeklyLearning';

/** How long a revisit may show the previous plan while it revalidates. */
const SHOW_WHILE_REFRESHING_MS = 5 * 60_000;

/**
 * The Dashboard Weekly Learning read, with useLearnerDetailParam's `'expired'`
 * rules: a return to the tab re-reads only when the cached plan has expired,
 * a save removed it, or the last read failed.
 */
export function useWeeklyLearning(kind: LearnerKind | null, learnerId: string | undefined, enabled = true, initialModuleId?: string | null) {
  const identity = kind && learnerId && enabled ? `${kind}:${learnerId}:${initialModuleId || ''}` : null;
  const [state, setState] = useState<{
    identity: string; real: WeeklyLearningDetail | null; loading: boolean; loadError: string | null;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const hasLoadError = useRef(false);
  hasLoadError.current = !!(identity && state?.identity === identity && state.loadError);
  const refresh = useCallback(() => setRefreshTick(tick => tick + 1), []);

  useEffect(() => {
    if (!identity || !kind || !learnerId) return;
    let lastRefresh = 0;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 1000) return;
      // A failed read is never cached, so an error always retries.
      if (!hasLoadError.current && peekWeeklyLearning(kind, learnerId, 0, initialModuleId)) return;
      lastRefresh = Date.now();
      refresh();
    };
    // Saves in this tab drop the shared entry. Unrelated saves leave it in place.
    const unsubscribe = subscribeLearnerReadInvalidation(() => {
      if (!peekWeeklyLearning(kind, learnerId, SHOW_WHILE_REFRESHING_MS, initialModuleId)) refresh();
    });
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [identity, kind, learnerId, refresh, initialModuleId]);

  useEffect(() => {
    if (!identity || !kind || !learnerId) return;
    let cancelled = false;
    const cached = peekWeeklyLearning(kind, learnerId, SHOW_WHILE_REFRESHING_MS, initialModuleId);
    setState(previous => {
      const real = previous?.identity === identity ? previous.real : cached ?? null;
      return { identity, real, loading: !real, loadError: null };
    });
    fetchWeeklyLearning(kind, learnerId, { revalidate: refreshTick > 0, moduleId: initialModuleId })
      .then(data => { if (!cancelled) { primeWeeklyLearningWeek(kind, learnerId, data); setState({ identity, real: data, loading: false, loadError: null }); } })
      .catch(error => {
        if (!cancelled) setState(previous => ({
          identity, real: previous?.identity === identity ? previous.real : null, loading: false,
          loadError: error instanceof Error ? error.message : 'Could not load learner',
        }));
      });
    return () => { cancelled = true; };
  }, [identity, kind, learnerId, refreshTick, initialModuleId]);

  // Hide the previous learner on the first render of a new identity.
  const current = identity && state?.identity === identity ? state : null;
  const cached = !current && identity && kind && learnerId
    ? peekWeeklyLearning(kind, learnerId, SHOW_WHILE_REFRESHING_MS, initialModuleId) : undefined;
  return {
    real: current?.real ?? cached ?? null,
    loading: current?.loading ?? (!!identity && !cached),
    loadError: current?.loadError ?? null,
    refresh,
  };
}

/** Identity-keyed state prevents a slow response replacing a newer selection. */
export function useWeeklyLearningWeek(kind: LearnerKind, learnerId: string, moduleId: string | null, weekId: string | null, enabled: boolean, revision: unknown) {
  const identity = enabled && moduleId && weekId ? JSON.stringify([kind, learnerId, moduleId, weekId]) : null;
  const [state, setState] = useState<{ identity: string; data: WeeklyLearningWeek | null; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  useEffect(() => subscribeLearnerReadInvalidation(() => {
    if (enabled && moduleId && weekId && !peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId)) refresh();
  }), [enabled, kind, learnerId, moduleId, weekId, refresh]);
  useEffect(() => {
    if (!identity || !moduleId || !weekId) return;
    let cancelled = false;
    const cached = peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId);
    setState({ identity, data: cached ?? null, error: null });
    fetchWeeklyLearningWeek(kind, learnerId, moduleId, weekId).then(data => {
      if (!cancelled) setState({ identity, data, error: null });
    }).catch(error => {
      if (!cancelled) setState({ identity, data: null, error: error instanceof Error ? error.message : 'Could not load this week.' });
    });
    return () => { cancelled = true; };
  }, [identity, kind, learnerId, moduleId, weekId, revision, retry]);
  const cached = enabled && moduleId && weekId ? peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId) : undefined;
  const current = state?.identity === identity ? state : null;
  return { data: cached ?? current?.data ?? null, loading: !!identity && !cached && !current?.data && !current?.error, error: current?.error ?? null, refresh };
}
