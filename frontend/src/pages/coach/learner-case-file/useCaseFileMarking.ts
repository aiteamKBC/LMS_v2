import { useCallback, useEffect, useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import type { CoachMarkingQueueItem } from './types';

type MarkingData = { items: CoachMarkingQueueItem[]; serializedItemCount: number };
type State = {
  learnerId: string | null;
  attempt: number;
  data: MarkingData | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
};

export function useCaseFileMarking(learnerId?: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ learnerId: null, attempt: 0, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !learnerId) return;
    if (state.learnerId === learnerId && state.status === 'success' && state.attempt === attempt) return;
    const controller = new AbortController();
    setState({ learnerId, attempt, data: null, status: 'loading', error: null });
    const query = new URLSearchParams({ page_size: '100', learner: learnerId });
    coachFetch(`/coach_api/coach/marking-queue?${query}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { items?: CoachMarkingQueueItem[]; detail?: string; error?: string; message?: string };
        if (!response.ok) throw new Error(payload.message || payload.detail || payload.error || 'Unable to load learner marking data.');
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.some(item => String(item.learnerId || '') !== learnerId)) {
          throw new Error('Marking data did not match the requested learner identity.');
        }
        if (!controller.signal.aborted) setState({
          learnerId, attempt, data: { items, serializedItemCount: items.length }, status: 'success', error: null,
        });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({
          learnerId, attempt, data: null, status: 'error',
          error: reason instanceof Error ? reason.message : 'Unable to load learner marking data.',
        });
      });
    return () => controller.abort();
  }, [attempt, enabled, learnerId]); // state is deliberately excluded: successful data is the page-lifetime cache.

  const current = state.learnerId === learnerId
    ? state
    : { learnerId: learnerId || null, attempt, data: null, status: enabled ? 'loading' as const : 'idle' as const, error: null };
  return { data: current.data, loading: current.status === 'loading', error: current.error, retry, invalidate: retry };
}
