import { useEffect, useState } from 'react';
import { fetchCoachCatchUpQueue } from '../api/catchUpApi';
import type { CatchUpRequestRow } from '../types/catchUp.types';

export function useCatchUpQueue(enabled: boolean) {
  const [rows, setRows] = useState<CatchUpRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setWarning('');
    fetchCoachCatchUpQueue(controller.signal).then(result => {
      if (!controller.signal.aborted) { setRows(result.rows); setWarning(result.warning); }
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      if (!controller.signal.aborted) { setRows([]); setError(reason instanceof Error ? reason.message : 'Could not load catch-up sessions.'); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled]);
  return { rows, loading, error, warning };
}
