import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from './useAuth.helpers';
import { fetchLearnerDetail, peekLearnerDetail, type LearnerDetail, type LearnerKind } from '@/api/learnerDetail';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';

/**
 * `true` re-reads on every return to the tab. `'expired'` re-reads only when the
 * shared cache entry has expired or a save removed it, so alt-tabbing does not
 * refetch the large payload while a valid response is in memory.
 */
export type LearnerDetailRefreshOnFocus = boolean | 'expired';

/**
 * Shared real-vs-mock data hook for learner self-view and staff drill-down
 * pages. Progress-changing API calls invalidate the shared cache themselves,
 * so ordinary sidebar navigation can reuse the short-lived cached payload.
 */
export function useLearnerDetailParam(
  kind: string | undefined, id: string | undefined, refreshOnFocus: LearnerDetailRefreshOnFocus = false,
  /** false defers the read (and reports no data) until a consumer needs it. */
  enabled = true,
) {
  const session = useCaseFileSession();
  const account = useContext(AuthContext)?.auth.account;
  const accountKey = JSON.stringify([account?.id, account?.role, account?.access, account?.subjectType, account?.subjectId, account?.learnerType]);
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const identity = isRealMode && id && enabled ? `${kind}:${id}` : null;
  const [state, setState] = useState<{
    identity: string; real: LearnerDetail | null; loading: boolean; loadError: string | null;
    accountKey: string; session: typeof session; request: object; isFetching: boolean;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const request = useMemo(() => ({ identity, accountKey, session, refreshTick }), [identity, accountKey, session, refreshTick]);
  const hasLoadError = useRef(false);
  hasLoadError.current = !!(identity && state?.identity === identity && state.accountKey === accountKey && state.session === session && state.loadError);

  const refresh = useCallback(() => {
    // A read must not invalidate every learner resource and restart the route
    // access check. Saves already invalidate their affected caches.
    setRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (session || !refreshOnFocus || !identity) return;
    // Returning from Module Builder must pick up assignments and newly added
    // content. Browsers can emit both visibilitychange and focus together.
    const onlyWhenExpired = refreshOnFocus === 'expired';
    const [learnerKind, learnerId] = identity.split(':') as [LearnerKind, string];
    let lastRefresh = 0;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 1000) return;
      // A failed read is never cached, so an error always retries.
      if (onlyWhenExpired && !hasLoadError.current && peekLearnerDetail(learnerKind, learnerId)) return;
      lastRefresh = Date.now();
      refresh();
    };
    // Saves in this tab drop the shared entry. Unrelated saves leave it in place.
    const unsubscribe = onlyWhenExpired
      ? subscribeLearnerReadInvalidation(() => {
        if (!peekLearnerDetail(learnerKind, learnerId, true)) refresh();
      })
      : undefined;
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refreshOnFocus, identity, refresh, session]);

  useEffect(() => {
    if (!isRealMode || !id || !identity) return;
    let cancelled = false;
    const cached = session ? undefined : peekLearnerDetail(kind as LearnerKind, id, true);
    setState((previous) => {
      const sameAccount = !previous || previous.accountKey === accountKey;
      const real = previous?.identity === identity && sameAccount && previous.session === session
        ? previous.real : sameAccount ? cached ?? null : null;
      return { identity, accountKey, session, request, real, loading: !real, loadError: null, isFetching: true };
    });
    (session ? session.detail(refreshTick > 0) : fetchLearnerDetail(kind as LearnerKind, id, { revalidate: refreshTick > 0 }))
      .then((data) => { if (!cancelled) setState({ identity, accountKey, session, request, real: data, loading: false, loadError: null, isFetching: false }); })
      .catch((error) => {
        if (!cancelled) setState((previous) => ({ identity, accountKey, session, request, real: previous?.identity === identity && previous.accountKey === accountKey && previous.session === session ? previous.real : null, loading: false, loadError: error instanceof Error ? error.message : 'Could not load learner', isFetching: false }));
      });
    return () => { cancelled = true; };
  }, [isRealMode, kind, id, identity, refreshTick, session, accountKey, request]);

  // Staff can move directly between View pages. Hide the previous learner in
  // the first render of the new URL, before the next request effect runs.
  const current = identity && state?.identity === identity && state.accountKey === accountKey && state.session === session ? state : null;
  const cached = !session && !current && identity && id && (!state || state.accountKey === accountKey) ? peekLearnerDetail(kind as LearnerKind, id, true) : undefined;
  // Cover the render before the request effect runs, including cached mounts
  // and manual refreshes. Only the current effect may settle fetching state.
  const isFetching = !!identity && (!current || current.request !== request || current.isFetching);
  return { isRealMode, real: current?.real ?? cached ?? null, loading: current?.loading ?? (!!identity && !cached), loadError: current?.loadError ?? null, refresh, isFetching };
}
