import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumModules, type CurriculumModule } from '@/lib/curriculumApi';

type LoadOptions = {
  silent?: boolean;
  skipCache?: boolean;
  revalidate?: boolean;
};

const MODULE_LOAD_RETRY_DELAY_MS = 400;

type UseCurriculumModulesOptions = {
  autoLoad?: boolean;
  skipCache?: boolean;
  revalidate?: boolean;
  compact?: boolean;
};

export function useCurriculumModules({ autoLoad = true, skipCache = false, revalidate = false, compact = false }: UseCurriculumModulesOptions = {}) {
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Callers rely on this promise to know when `modules` has actually been
  // updated (e.g. re-showing an edit form right after a save), so it must
  // resolve only once the fetch has settled and state has been written.
  const performLoad = useCallback((options: LoadOptions, signal: AbortSignal): Promise<void> => {
    if (!options.silent) {
      setLoading(true);
      setError(null);
    }

    const request = (retry: boolean): Promise<CurriculumModule[]> => fetchCurriculumModules(signal, { compact, skipCache: options.skipCache ?? skipCache, revalidate: options.revalidate ?? revalidate })
      .catch(error => {
        if (signal.aborted || retry) throw error;
        return new Promise<CurriculumModule[]>((resolve, reject) => {
          setTimeout(() => {
            fetchCurriculumModules(signal, { compact, skipCache: options.skipCache ?? skipCache, revalidate: options.revalidate ?? revalidate }).then(resolve, reject);
          }, MODULE_LOAD_RETRY_DELAY_MS);
        });
      });

    return request(false)
      .then(result => {
        if (!mountedRef.current || signal.aborted) return;
        setModules(result);
        setError(null);
      })
      .catch(err => {
        if (!mountedRef.current || signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load curriculum modules');
      })
      .finally(() => {
        if (mountedRef.current && !signal.aborted) setLoading(false);
      });
  }, [compact, skipCache, revalidate]);

  const load = useCallback((options: LoadOptions = {}) => {
    const controller = new AbortController();
    void performLoad(options, controller.signal);
    return () => controller.abort();
  }, [performLoad]);

  const reload = useCallback((options?: LoadOptions) => {
    const controller = new AbortController();
    return performLoad(options ?? {}, controller.signal);
  }, [performLoad]);

  useEffect(() => {
    if (!autoLoad) return;
    return load();
  }, [autoLoad, load]);

  return { modules, loading, error, reload };
}
