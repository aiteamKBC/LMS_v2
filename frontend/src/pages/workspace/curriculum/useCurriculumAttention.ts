import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumJson } from '@/lib/curriculumApi';
import type { AttentionKey } from './useCurriculumHome';

export interface AttentionRecord {
  id: string;
  name: string;
  programme: string;
  cohort: string;
  group: string;
}

export interface AttentionDetail {
  issue: AttentionKey;
  count: number;
  records: AttentionRecord[];
}

export type ProgrammeSectionKey = AttentionKey | 'no-modules' | 'no-delivery';

export interface ProgrammeReviewDetail {
  programme: { id: string; name: string };
  sections: Array<{ key: ProgrammeSectionKey; count: number; records: AttentionRecord[] }>;
}

// Details by request path, tagged with the summary generation they were read
// under. Reopening a modal in the same Home visit reuses them; a newer summary
// (a new visit, or a refresh after a write) makes them stale.
const detailCache = new Map<string, { generation: number; value: unknown }>();

export function clearAttentionCache() {
  detailCache.clear();
}

function useLazyDetail<T>(path: string | null, generation: number) {
  const cached = path ? detailCache.get(path) : undefined;
  const fresh = cached && cached.generation === generation ? (cached.value as T) : null;
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>({ path, data: fresh, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    const hit = detailCache.get(path);
    if (hit && hit.generation === generation) {
      setState({ path, data: hit.value as T, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ path, data: null, error: null });
    fetchCurriculumJson<T>(path, { signal: controller.signal, revalidate: true, timeoutMs: 30000 })
      .then(value => {
        if (controller.signal.aborted) return;
        detailCache.set(path, { generation, value });
        setState({ path, data: value, error: null });
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setState({ path, data: null, error: reason instanceof Error ? reason.message : 'Unable to load these records' });
      });
    return () => controller.abort();
  }, [path, generation, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const current = state.path === path ? state : { path, data: fresh, error: null };
  return { data: current.data, error: current.error, loading: Boolean(path) && !current.data && !current.error, retry };
}

/** The records behind one Needs attention count, read when its modal opens. */
export function useAttentionRecords(issue: AttentionKey | null, generation: number) {
  return useLazyDetail<AttentionDetail>(issue ? `/curriculum/home-attention/?issue=${encodeURIComponent(issue)}` : null, generation);
}

/** The modules and groups behind one programme card, read when its modal opens. */
export function useProgrammeReview(programmeId: string | null, generation: number) {
  return useLazyDetail<ProgrammeReviewDetail>(programmeId ? `/curriculum/home-attention/?programme=${encodeURIComponent(programmeId)}` : null, generation);
}
