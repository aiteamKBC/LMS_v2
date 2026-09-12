import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumSessions, type CurriculumSession } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export function useCurriculumSessions({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const [sessions, setSessions] = useState<CurriculumSession[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);

  // `silent` keeps the sessions already on screen while a background re-read
  // runs, rather than dropping the reader back to skeletons every tab switch.
  const load = useCallback((options: { silent?: boolean } = {}) => {
    const controller = new AbortController();
    let mounted = true;

    if (!options.silent) setLoading(true);
    fetchCurriculumSessions(controller.signal, { revalidate: options.silent })
      .then(result => {
        if (!mounted) return;
        setSessions(result);
        setError(null);
      })
      .catch(err => {
        if (!mounted || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load curriculum sessions');
      })
      .finally(() => {
        if (mounted && !options.silent) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!autoLoad) {
      setLoading(false);
      return undefined;
    }
    return load();
  }, [autoLoad, load]);

  useLiveRefresh(() => { load({ silent: true }); }, { enabled: autoLoad });

  return { sessions, loading, error, reload: () => load() };
}
