import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumModules, type CurriculumModule } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

type LoadOptions = {
  silent?: boolean;
  skipCache?: boolean;
  revalidate?: boolean;
};

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

    // `fetchCurriculumModules` already retries a retryable failure (a 5xx, a
    // dropped connection) itself, with its own backoff -- a second retry layer
    // here on top of that one does not make a flaky read more likely to
    // succeed, it just pays the same timeout budget twice in a row. A genuine
    // timeout is the case that matters most to fail fast from: it is excluded
    // from that inner retry on purpose, so this only ever gets one attempt at
    // it and settles into `error` promptly instead of quietly doubling the wait.
    return fetchCurriculumModules(signal, { compact, skipCache: options.skipCache ?? skipCache, revalidate: options.revalidate ?? revalidate })
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

  // Modules are authored from the builder, the workspace and the wizard, so a
  // list left open goes stale the moment anyone else saves. `revalidate` reads
  // past this tab's cache without forcing the backend rebuild.
  useLiveRefresh(() => {
    void reload({ silent: true, revalidate: true, skipCache: false });
  }, { enabled: autoLoad });

  return { modules, loading, error, reload };
}
