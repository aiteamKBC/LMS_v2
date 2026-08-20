import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumProgrammes, type CurriculumProgramme } from '@/lib/curriculumApi';

type LoadOptions = {
  silent?: boolean;
  skipCache?: boolean;
  visibility?: 'all' | 'operational';
};

type UseCurriculumProgrammesOptions = {
  skipCache?: boolean;
  visibility?: 'all' | 'operational';
};

export function useCurriculumProgrammes({ skipCache = false, visibility }: UseCurriculumProgrammesOptions = {}) {
  const [programmes, setProgrammes] = useState<CurriculumProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, options: LoadOptions = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!options.silent) setLoading(true);
    try {
      const programmeResult = await fetchCurriculumProgrammes(signal, { skipCache: options.skipCache ?? skipCache, visibility: options.visibility ?? visibility });
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
  }, [skipCache, visibility]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const removeProgramme = (id: string) => {
    setProgrammes(prev => prev.filter(p => (p.sourceId || p.id) !== id));
  };

  // Archiving is not a delete: the row has to stay in state and flip to
  // archived, or it leaves the active list without ever reaching the archive.
  const markProgrammeArchived = (id: string) => {
    setProgrammes(prev => prev.map(p => (
      (p.sourceId || p.id) === id ? { ...p, isArchived: true, status: 'archived' } : p
    )));
  };

  const markProgrammeRestored = (id: string) => {
    setProgrammes(prev => prev.map(p => (
      (p.sourceId || p.id) === id ? { ...p, isArchived: false, status: 'active' } : p
    )));
  };

  return {
    programmes,
    loading,
    error,
    reload: (options?: LoadOptions) => load(undefined, options),
    removeProgramme,
    markProgrammeArchived,
    markProgrammeRestored,
  };
}
