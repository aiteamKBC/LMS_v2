import { useCallback, useEffect, useState } from 'react';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
import { fetchCoachCatchUpQueue } from '../api/catchUpApi';
import type { CatchUpRequestRow, CatchUpSchedulingCandidate } from '../types/catchUp.types';

export function useCatchUpQueue(enabled: boolean) {
  const coach = useCoachIdentity();
  const cacheKey = coachSessionKey('catch-up-queue', coach.email);
  const initialCache = readCoachSessionCache<{ rows: CatchUpRequestRow[]; candidates: CatchUpSchedulingCandidate[]; warning: string }>(cacheKey);
  const [rows, setRows] = useState<CatchUpRequestRow[]>(() => initialCache?.rows || []);
  const [candidates, setCandidates] = useState<CatchUpSchedulingCandidate[]>(() => initialCache?.candidates || []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState(() => initialCache?.warning || '');
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const cached = readCoachSessionCache<{ rows: CatchUpRequestRow[]; candidates: CatchUpSchedulingCandidate[]; warning: string }>(cacheKey);
    if (cached) { setRows(cached.rows); setCandidates(cached.candidates || []); setWarning(cached.warning); setLoading(false); }
    else { setLoading(true); setWarning(''); }
    setError('');
    fetchCoachCatchUpQueue(controller.signal).then(result => {
      if (!controller.signal.aborted) {
        writeCoachSessionCache(cacheKey, result);
        setRows(result.rows); setCandidates(result.candidates); setWarning(result.warning);
      }
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      if (!controller.signal.aborted && !cached) { setRows([]); setCandidates([]); setError(reason instanceof Error ? reason.message : 'Could not load catch-up sessions.'); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cacheKey, enabled, refreshToken]);
  const refresh = useCallback(() => setRefreshToken(current => current + 1), []);
  return { rows, candidates, loading, error, warning, refresh };
}
