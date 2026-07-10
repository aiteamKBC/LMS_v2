import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumSessions, type CurriculumSession } from '@/lib/curriculumApi';

export function useCurriculumSessions() {
  const [sessions, setSessions] = useState<CurriculumSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    let mounted = true;

    setLoading(true);
    fetchCurriculumSessions(controller.signal)
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
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => load(), [load]);

  return { sessions, loading, error, reload: () => load() };
}
