import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumKsbFrameworks, type CurriculumKsbFramework } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export function useCurriculumKsbFrameworks() {
  const [frameworks, setFrameworks] = useState<CurriculumKsbFramework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((options: { silent?: boolean } = {}) => {
    const controller = new AbortController();
    let mounted = true;

    if (!options.silent) setLoading(true);
    fetchCurriculumKsbFrameworks(controller.signal)
      .then(result => {
        if (!mounted) return;
        setFrameworks(result);
        setError(null);
      })
      .catch(err => {
        if (!mounted || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load KSB frameworks');
      })
      .finally(() => {
        if (mounted && !options.silent) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => load(), [load]);

  useLiveRefresh(() => { load({ silent: true }); });

  return { frameworks, loading, error, reload: () => load() };
}
