import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumVersions } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export function useQualityVersionAvailability() {
  const [state, setState] = useState({ loading: true, available: false, error: false });
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(async (skipCache = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState(previous => ({ ...previous, loading: true, error: false }));
    try {
      // The existing endpoint supports a bounded read. Only availability is
      // needed here, never the full version index or individual snapshots.
      const result = await fetchCurriculumVersions({ limit: 1, signal: controller.signal, skipCache });
      if (typeof result.available !== 'boolean') throw new Error('Version availability was not provided');
      if (!controller.signal.aborted) setState({ loading: false, available: result.available === true, error: false });
    } catch {
      if (!controller.signal.aborted) setState({ loading: false, available: false, error: true });
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);
  useLiveRefresh(() => { void reload(); });
  return { ...state, reload };
}
