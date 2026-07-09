import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumComponents, fetchCurriculumOverview, type CurriculumOverview } from '@/lib/curriculumApi';

export function useCurriculumData() {
  const [data, setData] = useState<CurriculumOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const [overview, components] = await Promise.all([
        fetchCurriculumOverview(signal),
        fetchCurriculumComponents(signal).catch(() => []),
      ]);
      const result: CurriculumOverview = { ...overview, components };
      if (signal?.aborted || requestId !== requestIdRef.current) return null;
      setData(result);
      setError(null);
      return result;
    } catch (err) {
      if (signal?.aborted || requestId !== requestIdRef.current) return null;
      setError(err instanceof Error ? err.message : 'Unable to load curriculum data');
      return null;
    } finally {
      if (!signal?.aborted && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { data, loading, error, reload: () => load() };
}
