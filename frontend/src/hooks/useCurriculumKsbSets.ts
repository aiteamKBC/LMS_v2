import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumKsbSets, type CurriculumKsbSet } from '@/lib/curriculumApi';

export function useCurriculumKsbSets({ all = false }: { all?: boolean } = {}) {
  const [ksbSets, setKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    let mounted = true;

    setLoading(true);
    fetchCurriculumKsbSets(controller.signal, { all })
      .then(result => {
        if (!mounted) return;
        setKsbSets(result);
        setError(null);
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

  useEffect(() => load(), [load]);

  return { ksbSets, loading, error, reload: () => load() };
}
