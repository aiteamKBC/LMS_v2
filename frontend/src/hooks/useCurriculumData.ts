import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumComponents, fetchCurriculumHolidays, fetchCurriculumModules, fetchCurriculumOverview, type CurriculumOverview } from '@/lib/curriculumApi';

interface UseCurriculumDataOptions {
  compact?: boolean;
  includeComponents?: boolean;
  includeHolidays?: boolean;
  refreshModules?: boolean;
}

export function useCurriculumData({ compact = false, includeComponents = false, includeHolidays = false, refreshModules = false }: UseCurriculumDataOptions = {}) {
  const [data, setData] = useState<CurriculumOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const [overview, modules, components, holidays] = await Promise.all([
        fetchCurriculumOverview(signal, { compact }),
        refreshModules ? fetchCurriculumModules(signal).catch(() => []) : Promise.resolve([]),
        includeComponents ? fetchCurriculumComponents(signal).catch(() => []) : Promise.resolve([]),
        includeHolidays ? fetchCurriculumHolidays(signal).catch(() => []) : Promise.resolve([]),
      ]);
      const result: CurriculumOverview = {
        ...overview,
        modules: modules.length ? modules : overview.modules,
        components: includeComponents ? components : overview.components,
        holidays: includeHolidays ? holidays : overview.holidays,
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
  }, [compact, includeComponents, includeHolidays, refreshModules]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { data, loading, error, reload: () => load() };
}
