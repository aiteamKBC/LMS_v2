import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumComponents, fetchCurriculumModules, fetchCurriculumOverview, type CurriculumOverview } from '@/lib/curriculumApi';

interface UseCurriculumDataOptions {
  compact?: boolean;
  includeComponents?: boolean;
  refreshModules?: boolean;
}

export function useCurriculumData({ compact = false, includeComponents = false, refreshModules = false }: UseCurriculumDataOptions = {}) {
  const [data, setData] = useState<CurriculumOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const [overview, modules, components] = await Promise.all([
        fetchCurriculumOverview(signal, { compact }),
        refreshModules ? fetchCurriculumModules(signal).catch(() => []) : Promise.resolve([]),
        includeComponents ? fetchCurriculumComponents(signal).catch(() => []) : Promise.resolve([]),
      ]);
      const result: CurriculumOverview = {
        ...overview,
        modules: modules.length ? modules : overview.modules,
        components: includeComponents ? components : overview.components,
      };
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
  }, [compact, includeComponents, refreshModules]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { data, loading, error, reload: () => load() };
}
