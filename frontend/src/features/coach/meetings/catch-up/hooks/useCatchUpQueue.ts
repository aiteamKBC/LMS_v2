import { useEffect, useState } from 'react';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
import { fetchCoachCatchUpQueue } from '../api/catchUpApi';
import type { CatchUpRequestRow } from '../types/catchUp.types';

export function useCatchUpQueue(enabled: boolean) {
  const coach = useCoachIdentity();
  const cacheKey = coachSessionKey('catch-up-queue', coach.email);
  const initialCache = readCoachSessionCache<{ rows: CatchUpRequestRow[]; warning: string }>(cacheKey);
  const [rows, setRows] = useState<CatchUpRequestRow[]>(() => initialCache?.rows || []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState(() => initialCache?.warning || '');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const cached = readCoachSessionCache<{ rows: CatchUpRequestRow[]; warning: string }>(cacheKey);
    if (cached) { setRows(cached.rows); setWarning(cached.warning); setLoading(false); }
    else { setLoading(true); setWarning(''); }
    setError('');
    fetchCoachCatchUpQueue(controller.signal).then(result => {
      if (!controller.signal.aborted) {
        writeCoachSessionCache(cacheKey, result);
        setRows(result.rows); setWarning(result.warning);
      }
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      if (!controller.signal.aborted && !cached) { setRows([]); setError(reason instanceof Error ? reason.message : 'Could not load catch-up sessions.'); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cacheKey, enabled]);
  return { rows, loading, error, warning };
}
