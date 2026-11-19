import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';
import { fetchCurriculumJson } from '@/lib/curriculumApi';

export interface DeliveryOverview {
  modules: Array<{ id: string; moduleCatalogueId: string; groupId: string; cohortId: string; tutor: string; status: string; isFreeCourse: boolean }>;
  cohorts: Array<{ id: string; status: string }>;
  groups: Array<{ id: string; cohortId: string; coach: string; moduleIds: string[] }>;
}

/** Independent small reads. Mount/focus revalidation observes the server write
 * epoch; the existing API coalesces StrictMode without forcing server rebuilds. */
export function useDeliveryRead<T>(path: string, scope: string) {
  const [result, setResult] = useState<{ scope: string; data: T | null; loading: boolean; error: string | null }>(
    { scope, data: null, loading: true, error: null });
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setResult(previous => previous.scope === scope ? { ...previous, loading: !previous.data }
      : { scope, data: null, loading: true, error: null });
    void fetchCurriculumJson<T>(path, { signal: current.signal, revalidate: true, timeoutMs: 30_000 }).then(data => {
      if (!current.signal.aborted) setResult({ scope, data, loading: false, error: null });
    }).catch(error => {
      if (!current.signal.aborted) setResult(previous => ({ ...previous, scope, loading: false,
        error: error instanceof Error ? error.message : 'Delivery data could not be loaded' }));
    });
  }, [path, scope]);
  useEffect(() => { reload(); return () => controller.current?.abort(); }, [reload]);
  useLiveRefresh(reload);
  return { ...(result.scope === scope ? result : { data: null, loading: true, error: null }), reload };
}

export function useDeliveryOverview() {
  const { auth } = useAuth();
  const scope = JSON.stringify([auth?.account?.id, auth?.account?.role, auth?.account?.access, auth?.tenant?.id]);
  return useDeliveryRead<DeliveryOverview>('/curriculum/delivery-dashboard/', scope);
}
