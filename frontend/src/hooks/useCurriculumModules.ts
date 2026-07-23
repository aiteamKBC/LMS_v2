import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumModules, type CurriculumModule } from '@/lib/curriculumApi';

type LoadOptions = {
  silent?: boolean;
};

const MODULE_LOAD_RETRY_DELAY_MS = 400;

type UseCurriculumModulesOptions = {
  autoLoad?: boolean;
};

export function useCurriculumModules({ autoLoad = true }: UseCurriculumModulesOptions = {}) {
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((options: LoadOptions = {}) => {
    const controller = new AbortController();
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    if (!options.silent) {
      setLoading(true);
      setError(null);
    }

    const request = (retry: boolean): Promise<CurriculumModule[]> => fetchCurriculumModules(controller.signal)
      .catch(error => {
        if (controller.signal.aborted || retry) throw error;
        return new Promise<CurriculumModule[]>((resolve, reject) => {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            fetchCurriculumModules(controller.signal).then(resolve, reject);
          }, MODULE_LOAD_RETRY_DELAY_MS);
        });
      });

    request(false)
      .then(result => {
        if (!mounted) return;
        setModules(result);
        setError(null);
      })
      .catch(err => {
        if (!mounted || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load curriculum modules');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
      controller.abort();
    };
  }, []);

  const reload = useCallback((options?: LoadOptions) => load(options), [load]);

  useEffect(() => {
    if (!autoLoad) return;
    return load();
  }, [autoLoad, load]);

  return { modules, loading, error, reload };
}
