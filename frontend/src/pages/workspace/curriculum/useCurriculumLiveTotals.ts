import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumJson } from '@/lib/curriculumApi';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export const LIVE_TOTAL_KEYS = ['modules', 'cohorts', 'groups', 'sessions', 'programmes'] as const;
export type LiveTotalKey = typeof LIVE_TOTAL_KEYS[number];
export interface LiveTotal { active: number; total: number }
export interface CurriculumLiveTotals {
  metrics: Record<LiveTotalKey, LiveTotal>;
  checkedAt: string;
}

function verifiedTotals(value: CurriculumLiveTotals): CurriculumLiveTotals {
  if (!value || !value.metrics || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || LIVE_TOTAL_KEYS.some(key => {
    const metric = value.metrics[key];
    return !metric || !Number.isSafeInteger(metric.active) || !Number.isSafeInteger(metric.total)
      || metric.active < 0 || metric.total < metric.active;
  })) {
    throw new Error('Live totals could not be verified. Please retry.');
  }
  return value;
}

export function useCurriculumLiveTotals() {
  const [data, setData] = useState<CurriculumLiveTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRefreshing(true);
    try {
      const result = await fetchCurriculumJson<CurriculumLiveTotals>('/curriculum/live-totals/', {
        signal: current.signal, skipCache: true, timeoutMs: 30000,
      });
      if (current.signal.aborted) return;
      setData(verifiedTotals(result));
      setError(null);
    } catch (reason) {
      if (current.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Live totals are unavailable.');
    } finally {
      if (!current.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);
  useLiveRefresh(() => { void reload(); });
  return { data, loading, refreshing, error, reload };
}
