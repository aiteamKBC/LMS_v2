import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumJson } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export type AttentionKey = 'programme-ksb-source' | 'module-mapping' | 'draft-content' | 'group-coach' | 'module-tutor';

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
  attentionCounts: Record<AttentionKey, number>;
  continueModules: HomeModule[];
  programmeFocus: ProgrammeFocus[];
}

/**
 * Coming back to the tab re-reads only once the summary is this old. Focus
 * fires on every DevTools click and alt-tab; the Home counts do not change that
 * often, and navigating back to Home always re-reads on mount.
 */
export const HOME_RETURN_REFRESH_MS = 60_000;

// Bumped by every successful summary read. Attention details cached under an
// older generation are re-read, so a new Home visit never shows pre-write rows.
let summaryGeneration = 0;

export function useCurriculumHome() {
  const [data, setData] = useState<CurriculumHomeSummary | null>(null);
  const [generation, setGeneration] = useState(summaryGeneration);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loadedAt = useRef(0);
  const pendingAbort = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      // Revalidate on mount: this small response should observe the server's
      // write epoch without depending on overview's client invalidation rules.
      // It still uses the server cache and request dedup.
      const result = await fetchCurriculumJson<CurriculumHomeSummary>('/curriculum/home-summary/', {
        signal: current.signal, revalidate: true, timeoutMs: 30000,
      });
      if (current.signal.aborted) return;
      loadedAt.current = Date.now();
      summaryGeneration += 1;
      setGeneration(summaryGeneration);
      setData(result);
      setError(null);
    } catch (reason) {
      if (current.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Unable to load curriculum summary');
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // StrictMode unmounts and remounts synchronously in development. Defer the
    // unmount abort one task so the remount keeps the request already in flight
    // instead of cancelling it and sending a second one.
    if (pendingAbort.current) {
      clearTimeout(pendingAbort.current);
      pendingAbort.current = null;
    }
    if (!controller.current) void reload();
    return () => {
      pendingAbort.current = setTimeout(() => {
        pendingAbort.current = null;
        controller.current?.abort();
      }, 0);
    };
  }, [reload]);

  useLiveRefresh(() => {
    // A read in flight already answers this return; a recent one is current.
    if (controller.current || Date.now() - loadedAt.current < HOME_RETURN_REFRESH_MS) return;
    void reload();
  });
  return { data, generation, loading, error, reload };
}
