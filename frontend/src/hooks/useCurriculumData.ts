import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumComponents, fetchCurriculumHolidays, fetchCurriculumModules, fetchCurriculumOverview, type CurriculumOverview } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

interface UseCurriculumDataOptions {
  autoLoad?: boolean;
  compact?: boolean;
  includeComponents?: boolean;
  includeHolidays?: boolean;
  refreshModules?: boolean;
  // Drops weekStructure from the refreshed module list. Opt-in per caller, because
  // consumers that read weekStructure (or rank duplicate modules by component
  // count) need the full payload — see fetchCurriculumModules.
  compactModules?: boolean;
}

type LoadOptions = {
  skipCache?: boolean;
  // Ignores the client cache but lets the server answer from its own. What a
  // background re-read after somebody else's write wants: current rows without
  // the multi-second overview rebuild `skipCache` forces.
  revalidate?: boolean;
  // Keeps the previously loaded data on screen while refreshing in the background.
  // Callers that refresh after a successful save use this so the page does not
  // fall back to skeletons once the user has already seen the saved state.
  silent?: boolean;
};

export function useCurriculumData({ autoLoad = true, compact = false, includeComponents = false, includeHolidays = false, refreshModules = false, compactModules = false }: UseCurriculumDataOptions = {}) {
  const [data, setData] = useState<CurriculumOverview | null>(null);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, options: LoadOptions = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!options.silent) setLoading(true);
    try {
      const [overview, modules, components, holidays] = await Promise.all([
        fetchCurriculumOverview(signal, { compact, skipCache: options.skipCache, revalidate: options.revalidate }),
        refreshModules ? fetchCurriculumModules(signal, { compact: compactModules, skipCache: options.skipCache, revalidate: options.revalidate }).catch(() => []) : Promise.resolve([]),
        includeComponents ? fetchCurriculumComponents(signal, { skipCache: options.skipCache, revalidate: options.revalidate }).catch(() => []) : Promise.resolve([]),
        includeHolidays ? fetchCurriculumHolidays(signal, { skipCache: options.skipCache, revalidate: options.revalidate }).catch(() => []) : Promise.resolve([]),
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
      if (!options.silent && !signal?.aborted && requestId === requestIdRef.current) setLoading(false);
    }
  }, [compact, compactModules, includeComponents, includeHolidays, refreshModules]);

  useEffect(() => {
    if (!autoLoad) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [autoLoad, load]);

  // Re-read when the reader comes back to the tab, and when another tab writes.
  // Off when the caller drives its own loading: a page that chose not to auto-
  // load has not asked for this data yet, and must not be given it behind its back.
  useLiveRefresh(() => {
    void load(undefined, { silent: true, revalidate: true });
  }, { enabled: autoLoad });

  return { data, loading, error, reload: (options?: LoadOptions) => load(undefined, options) };
}
