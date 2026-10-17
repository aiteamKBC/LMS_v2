import { traceWeeklyLearning } from '@/api/weeklyLearningDiagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';
import { fetchWeeklyLearning, peekWeeklyLearning, primeWeeklyLearningWeek, fetchWeeklyLearningWeek, peekWeeklyLearningWeek, prefetchWeeklyLearningWeek, type WeeklyLearningDetail, type WeeklyLearningWeek } from '@/api/weeklyLearning';

/** How long a revisit may show the previous plan while it revalidates. */
const SHOW_WHILE_REFRESHING_MS = 5 * 60_000;

/**
 * The Dashboard Weekly Learning read, with useLearnerDetailParam's `'expired'`
 * rules: a return to the tab re-reads only when the cached plan has expired,
 * a save removed it, or the last read failed.
 */
export function useWeeklyLearning(kind: LearnerKind | null, learnerId: string | undefined, enabled = true, initialModuleId?: string | null) {
  const identity = kind && learnerId && enabled ? `${kind}:${learnerId}:${initialModuleId || ''}` : null;
  const traceKey = `${kind}:${learnerId}${initialModuleId ? `|${encodeURIComponent(initialModuleId)}` : ''}`;
  const [state, setState] = useState<{
    identity: string; real: WeeklyLearningDetail | null; loading: boolean; loadError: string | null;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshedIdentity = useRef<string | null>(null);
  const consumedRefresh = useRef(0);
  const acceptedIdentity = useRef<string | null>(null);
  const hasSnapshot = !!(identity && kind && learnerId && peekWeeklyLearning(kind, learnerId, Number.POSITIVE_INFINITY, initialModuleId));
  const hasLoadError = useRef(false);
  hasLoadError.current = !!(identity && state?.identity === identity && state.loadError);
  const requestRefresh = useCallback((reason: string) => { traceWeeklyLearning('refresh', traceKey, reason); refreshedIdentity.current = identity; setRefreshTick(tick => tick + 1); }, [identity, traceKey]);
  const refresh = useCallback(() => requestRefresh('manual'), [requestRefresh]);

  useEffect(() => {
    if (!identity || !kind || !learnerId) return;
    let lastRefresh = 0;
    const onReturn = (event: Event) => {
      traceWeeklyLearning('browser-event', traceKey, event.type);
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 1000) return;
      // A failed read is never cached, so an error always retries.
      if (!hasLoadError.current && peekWeeklyLearning(kind, learnerId, 0, initialModuleId)) return;
      lastRefresh = Date.now();
      requestRefresh(event.type);
    };
    // Saves in this tab drop the shared entry. Unrelated saves leave it in place.
    const unsubscribe = subscribeLearnerReadInvalidation(() => {
      if (!peekWeeklyLearning(kind, learnerId, SHOW_WHILE_REFRESHING_MS, initialModuleId)) requestRefresh('invalidation');
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
  }, [identity, kind, learnerId, requestRefresh, initialModuleId, traceKey]);

  useEffect(() => {
    if (!identity || !kind || !learnerId) return;
    if (hasSnapshot && acceptedIdentity.current === identity && consumedRefresh.current === refreshTick) return;
    traceWeeklyLearning('effect-start', traceKey);
    let cancelled = false;
    const cached = peekWeeklyLearning(kind, learnerId, SHOW_WHILE_REFRESHING_MS, initialModuleId);
    setState(previous => {
      const real = previous?.identity === identity ? previous.real : cached ?? null;
      return { identity, real, loading: !real, loadError: null };
    });
    const revalidate = refreshTick !== consumedRefresh.current && refreshedIdentity.current === identity;
    consumedRefresh.current = refreshTick;
    fetchWeeklyLearning(kind, learnerId, { revalidate, moduleId: initialModuleId })
      .then(data => { if (!cancelled && peekWeeklyLearning(kind, learnerId, 0, initialModuleId) === data) { acceptedIdentity.current = identity; primeWeeklyLearningWeek(kind, learnerId, data); setState({ identity, real: data, loading: false, loadError: null }); } })
      .catch(error => {
        if (!cancelled) setState(previous => ({
          identity, real: previous?.identity === identity ? previous.real : null, loading: false,
          loadError: error instanceof Error ? error.message : 'Could not load learner',
        }));
      });
    return () => { traceWeeklyLearning('effect-cleanup', traceKey); cancelled = true; };
  }, [identity, kind, learnerId, refreshTick, initialModuleId, hasSnapshot, traceKey]);

  // Hide the previous learner on the first render of a new identity.
  const current = identity && state?.identity === identity ? state : null;
  const cached = identity && kind && learnerId
    ? peekWeeklyLearning(kind, learnerId, SHOW_WHILE_REFRESHING_MS, initialModuleId) : undefined;
  const retained = identity && kind && learnerId
    ? peekWeeklyLearning(kind, learnerId, Number.POSITIVE_INFINITY, initialModuleId) : undefined;
  // Account resets remove the cache even when the requested learner is the
  // same. Never keep exposing a hook-owned copy across that boundary.
  const visible = current?.real && current.real === retained ? current.real : cached ?? null;
  return {
    real: visible,
    loading: current?.loading ?? (!!identity && !visible),
    loadError: current?.loadError ?? null,
    refresh,
  };
}

/** Identity-keyed state prevents a slow response replacing a newer selection. */
export function useWeeklyLearningWeek(kind: LearnerKind, learnerId: string, moduleId: string | null, weekId: string | null, enabled: boolean, revision: unknown, adjacentWeekId?: string | null) {
  const identity = enabled && moduleId && weekId ? JSON.stringify([kind, learnerId, moduleId, weekId]) : null;
  const [state, setState] = useState<{ identity: string; data: WeeklyLearningWeek | null; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const accepted = useRef<WeeklyLearningWeek | null>(null);
  const hasSnapshot = !!(enabled && moduleId && weekId && peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId, Number.POSITIVE_INFINITY));
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  useEffect(() => subscribeLearnerReadInvalidation(() => {
    if (enabled && moduleId && weekId && !peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId)) refresh();
  }), [enabled, kind, learnerId, moduleId, weekId, refresh]);
  useEffect(() => {
    if (!identity || !moduleId || !weekId) return;
    let cancelled = false;
    const cached = peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId);
    if (cached && cached === accepted.current) return;
    setState({ identity, data: cached ?? null, error: null });
    fetchWeeklyLearningWeek(kind, learnerId, moduleId, weekId).then(data => {
      if (!cancelled && peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId) === data) { accepted.current = data; setState({ identity, data, error: null }); }
    }).catch(error => {
      if (!cancelled) setState({ identity, data: null, error: error instanceof Error ? error.message : 'Could not load this week.' });
    });
    return () => { cancelled = true; };
  }, [identity, kind, learnerId, moduleId, weekId, revision, retry, hasSnapshot]);
  const cached = enabled && moduleId && weekId ? peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId) : undefined;
  const retained = enabled && moduleId && weekId ? peekWeeklyLearningWeek(kind, learnerId, moduleId, weekId, Number.POSITIVE_INFINITY) : undefined;
  const current = state?.identity === identity ? state : null;
  const visible = cached ?? (current?.data === retained ? current?.data : null) ?? null;
  useEffect(() => {
    // Only one neighbour, after the selected request has settled. Navigation
    // changes cancel the delay; prefetch uses the existing deduplicated cache.
    if (!enabled || !visible || !moduleId || !adjacentWeekId || adjacentWeekId === weekId
      || peekWeeklyLearningWeek(kind, learnerId, moduleId, adjacentWeekId)) return;
    const timer = window.setTimeout(() => {
      void prefetchWeeklyLearningWeek(kind, learnerId, moduleId, adjacentWeekId);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [enabled, visible, kind, learnerId, moduleId, weekId, adjacentWeekId]);
  return { data: visible, loading: !!identity && !visible && !current?.error, error: current?.error ?? null, refresh };
}
