import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';
import { fetchCurriculumSessions, type CurriculumSession } from '@/lib/curriculumApi';

/** Stage the calendar read behind the compact overview. Reuse the API's shared
 * cache/in-flight reads; never load authoring trees or force a server rebuild. */
export function useDeliverySessions(enabled: boolean, scope: string) {
  const [result, setResult] = useState<{
    scope: string; sessions: CurriculumSession[]; loading: boolean; error: string | null;
  }>({ scope, sessions: [], loading: true, error: null });
  const request = useRef<AbortController | null>(null);
  const load = useCallback((revalidate = false) => {
    if (!enabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setResult(previous => previous.scope === scope
      ? { ...previous, loading: !revalidate && !previous.sessions.length }
      : { scope, sessions: [], loading: true, error: null });
    void fetchCurriculumSessions(controller.signal, { revalidate }).then(sessions => {
      if (!controller.signal.aborted) setResult({ scope, sessions, loading: false, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setResult(previous => ({ ...previous, scope, loading: false,
        error: error instanceof Error ? error.message : 'Unable to load live sessions' }));
    });
  }, [enabled, scope]);
  useEffect(() => {
    load();
    return () => request.current?.abort();
  }, [load]);
  useLiveRefresh(() => load(true), { enabled });
  return result.scope === scope ? result : { sessions: [], loading: true, error: null };
}
