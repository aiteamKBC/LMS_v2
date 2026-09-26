import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';

type AttendanceState = {
  identity: string | null;
  data: LearnerAttendance | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
};

export function useCaseFileAttendance(
  kind?: LearnerKind | null,
  learnerId?: string | null,
  enabled = true,
) {
  const identity = kind && learnerId ? `${kind}:${learnerId}` : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AttendanceState>({ identity: null, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !kind || !learnerId || !identity) {
      setState({ identity: null, data: null, status: 'idle', error: null });
      return;
    }
    const controller = new AbortController();
    setState(current => current.identity === identity && current.status === 'success'
      ? current
      : { identity, data: null, status: 'loading', error: null });
    void fetchLearnerAttendance(kind, learnerId, controller.signal, attempt > 0).then(data => {
      if (!controller.signal.aborted) setState({ identity, data, status: 'success', error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({
        identity,
        data: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to load learner attendance.',
      });
    });
    return () => controller.abort();
  }, [attempt, enabled, identity, kind, learnerId]);

  const current = state.identity === identity ? state : { identity, data: null, status: identity ? 'loading' as const : 'idle' as const, error: null };
  return {
    data: current.data,
    loading: current.status === 'loading',
    error: current.error,
    retry,
    invalidate: retry,
  };
}
