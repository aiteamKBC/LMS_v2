import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readCoachJson } from '@/features/coach/case-file/api/caseFileApi';
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
  const session = useCaseFileSession();
  const completed = useRef<{ learnerId: string; attempt: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ learnerId: null, attempt: 0, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !learnerId) return;
    if (completed.current?.learnerId === learnerId && completed.current.attempt === attempt) return;
    const controller = new AbortController();
    setState({ learnerId, attempt, data: null, status: 'loading', error: null });
    const query = new URLSearchParams({ page_size: '100', learner: learnerId });
    const load = session
      ? session.read<{ items?: CoachMarkingQueueItem[] }>('assignments', { resource: 'marking' }, { signal: controller.signal, refresh: attempt > 0 })
      : readCoachJson<{ items?: CoachMarkingQueueItem[] }>(`/coach_api/coach/marking-queue?${query}`, controller.signal);
    void load.then(payload => {
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.some(item => String(item.learnerId || '') !== learnerId)) {
          throw new Error('Marking data did not match the requested learner identity.');
        }
        if (!controller.signal.aborted) { completed.current = { learnerId, attempt }; setState({
          learnerId, attempt, data: { items, serializedItemCount: items.length }, status: 'success', error: null,
        }); }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({
          learnerId, attempt, data: null, status: 'error',
          error: reason instanceof Error ? reason.message : 'Unable to load learner marking data.',
        });
      });
    return () => controller.abort();
  }, [attempt, enabled, learnerId, session]); // state is deliberately excluded: successful data is the page-lifetime cache.

  const current = state.learnerId === learnerId
    ? state
    : { learnerId: learnerId || null, attempt, data: null, status: enabled ? 'loading' as const : 'idle' as const, error: null };
  return { data: current.data, loading: current.status === 'loading', error: current.error, retry, invalidate: retry };
}
