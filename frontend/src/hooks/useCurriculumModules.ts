import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumModules, type CurriculumModule } from '@/lib/curriculumApi';

type LoadOptions = {
  silent?: boolean;
};

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

    if (!options.silent) setLoading(true);
    fetchCurriculumModules(controller.signal)
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
