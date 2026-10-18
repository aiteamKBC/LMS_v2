import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumJson } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export interface HomeModule {
  id: string;
  name: string;
  programme: string;
  weeks: number;
  status: string;
}

export interface ProgrammeFocus {
  programme: { id: string; name: string };
  issues: string[];
  issueCount: number;
}

export interface CurriculumHomeSummary {
  stats: { programmes: number; activeCohorts: number; groups: number; openIssues: number };
  attentionCounts: Record<'programme-ksb-source' | 'module-mapping' | 'draft-content' | 'group-coach' | 'module-tutor', number>;
  continueModules: HomeModule[];
  programmeFocus: ProgrammeFocus[];
}

export function useCurriculumHome() {
  const [data, setData] = useState<CurriculumHomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      // Revalidate on mount as well as live refresh: this small response should
      // observe the server's write epoch without depending on overview's client
      // invalidation rules. It still uses the server cache and request dedup.
      const result = await fetchCurriculumJson<CurriculumHomeSummary>('/curriculum/home-summary/', {
        signal: current.signal, revalidate: true, timeoutMs: 30000,
      });
      if (current.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (reason) {
      if (current.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Unable to load curriculum summary');
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);
  useLiveRefresh(() => { void reload(); });
  return { data, loading, error, reload };
}
