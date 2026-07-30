import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumProgrammes, type CurriculumProgramme } from '@/lib/curriculumApi';

export function useCurriculumProgrammes() {
  const [programmes, setProgrammes] = useState<CurriculumProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, options: { silent?: boolean } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!options.silent) setLoading(true);
    try {
      const programmeResult = await fetchCurriculumProgrammes(signal);
      if (signal?.aborted || requestId !== requestIdRef.current) return [];
      setProgrammes(programmeResult);
      setError(null);
      return programmeResult;
    } catch (err) {
      if (signal?.aborted || requestId !== requestIdRef.current) return [];
      setError(err instanceof Error ? err.message : 'Unable to load curriculum programmes');
      return [];
    } finally {
      if (!options.silent && !signal?.aborted && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { programmes, loading, error, reload: (options?: { silent?: boolean }) => load(undefined, options) };
}
