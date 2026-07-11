import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumKsbFrameworks, type CurriculumKsbFramework } from '@/lib/curriculumApi';

export function useCurriculumKsbFrameworks() {
  const [frameworks, setFrameworks] = useState<CurriculumKsbFramework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    let mounted = true;

    setLoading(true);
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
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => load(), [load]);

  return { frameworks, loading, error, reload: () => load() };
}
