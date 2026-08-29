import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumKsbSets, type CurriculumKsbSet } from '@/lib/curriculumApi';

type UseCurriculumKsbSetsOptions = {
  all?: boolean;
  /**
   * Defer the fetch until the caller actually needs KSB data (e.g. a module
   * editor drawer or KSB map modal has opened), rather than paying for it on
   * every page that mounts this hook. Defaults to true so existing callers
   * that always need it are unaffected. Fetches once the first time it turns
   * true and keeps the result cached across later toggles -- call `reload`
   * for a fresh copy.
   */
  enabled?: boolean;
};

export function useCurriculumKsbSets({ all = false, enabled = true }: UseCurriculumKsbSetsOptions = {}) {
  const [ksbSets, setKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    let mounted = true;

    setLoading(true);
    fetchCurriculumKsbSets(controller.signal, { all })
      .then(result => {
        if (!mounted) return;
        setKsbSets(result);
        setError(null);
        // Do not mark this request as complete until its value has actually
        // reached the mounted consumer. React StrictMode deliberately runs an
        // effect setup/cleanup/setup cycle in development. Marking it before
        // the request resolved made the cleanup abort the first subscriber and
        // the second setup incorrectly believe the KSB sets were already here.
        hasLoadedRef.current = true;
      })
      .catch(err => {
        if (!mounted || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load KSB mapping');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [all]);

  useEffect(() => {
    if (!enabled || hasLoadedRef.current) return undefined;
    return load();
  }, [enabled, load]);

  return { ksbSets, loading, error, reload: () => load() };
}
