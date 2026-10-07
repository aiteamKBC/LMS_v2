import { useCallback, useEffect, useState } from 'react';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerAttendance, attendanceForDisplay, type LearnerAttendance } from '@/api/learnerAttendance';

type AttendanceState = {
  identity: string | null;
  data: LearnerAttendance | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  historyLoaded?: boolean;
};

export function useCaseFileAttendance(
  kind?: LearnerKind | null,
  learnerId?: string | null,
  enabled = true,
  requested = true,
) {
  const session = useCaseFileSession();
  const [historyActivated, setHistoryActivated] = useState(requested);
  useEffect(() => { if (requested) setHistoryActivated(true); }, [requested]);
  const identity = kind && learnerId ? `${kind}:${learnerId}` : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AttendanceState>({ identity: null, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !kind || !learnerId || !identity || (session && !historyActivated)) {
      setState({ identity: null, data: null, status: 'idle', error: null });
      return;
    }
    const controller = new AbortController();
    setState(current => current.identity === identity && current.status === 'success'
      ? current
      : { identity, data: null, status: 'loading', error: null });
    const read = session ? session.read<{ attendance: LearnerAttendance | null }>('attendance', { resource: 'history' }, { signal: controller.signal, refresh: attempt > 0 }).then(payload => attendanceForDisplay(payload.attendance) ?? null) : fetchLearnerAttendance(kind, learnerId, controller.signal, attempt > 0);
    void read.then(data => {
      if (!controller.signal.aborted) setState({ identity, data, status: 'success', error: null, historyLoaded: !session || historyActivated });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({
        identity,
        data: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to load learner attendance.',
      });
    });
    return () => controller.abort();
  }, [attempt, enabled, identity, kind, learnerId, session, historyActivated]);

  const current: AttendanceState = state.identity === identity ? state : { identity, data: null, status: enabled && identity && (!session || historyActivated) ? 'loading' : 'idle', error: null };
  return {
    data: current.data,
    loading: current.status === 'loading' || Boolean(session && requested && !current.historyLoaded && current.status !== 'error'),
    error: current.error,
    retry,
    invalidate: retry,
  };
}
