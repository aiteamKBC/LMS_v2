import { useCallback, useEffect, useRef, useState } from 'react';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';

type AttendanceState = {
  identity: string | null;
  data: AttendanceData | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  historyLoaded?: boolean;
  projection?: AttendanceProjection;
};

type AttendanceData = Pick<LearnerAttendance, 'sessions' | 'present' | 'absent' | 'attendanceRate'> & {
  sessionHistory: Array<{ id: string; title: string; date: string; status: string; sessionType?: string; reason?: string | null }>;
};

export type AttendanceProjection = {
  summary: Pick<LearnerAttendance, 'sessions' | 'present' | 'absent' | 'attendanceRate'> & { outstandingAbsences: number };
  sessions: Array<{ id: string; title: string; date: string; status: string; reason: string | null }>;
  months: string[];
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean };
};

export function useCaseFileAttendance(
  kind?: LearnerKind | null,
  learnerId?: string | null,
  enabled = true,
  requested = true,
) {
  const session = useCaseFileSession();
  const [selection, setSelection] = useState({ search: '', status: 'all', month: 'all', page: '1', pageSize: '20' });
  const [historyActivated, setHistoryActivated] = useState(requested);
  useEffect(() => { if (requested) setHistoryActivated(true); }, [requested]);
  const identity = kind && learnerId ? `${kind}:${learnerId}` : null;
  const [attempt, setAttempt] = useState(0);
  const lastAttempt = useRef(0);
  const [state, setState] = useState<AttendanceState>({ identity: null, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !kind || !learnerId || !identity || (session && !historyActivated)) {
      setState({ identity: null, data: null, status: 'idle', error: null });
      return;
    }
    if (session && !requested) return;
    const refresh = attempt !== lastAttempt.current;
    lastAttempt.current = attempt;
    const controller = new AbortController();
    setState(current => current.identity === identity && current.status === 'success'
      ? current
      : { identity, data: null, status: 'loading', error: null });
    const read = session ? session.read<AttendanceProjection>('attendance', selection, { signal: controller.signal, refresh }).then(projection => ({ projection, data: { ...projection.summary, sessionHistory: projection.sessions } })) : fetchLearnerAttendance(kind, learnerId, controller.signal, refresh).then(data => ({ data, projection: undefined }));
    void read.then(({ data, projection }) => {
      if (!controller.signal.aborted) setState({ identity, data, projection, status: 'success', error: null, historyLoaded: !session || historyActivated });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({
        identity,
        data: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to load learner attendance.',
      });
    });
    return () => controller.abort();
  }, [attempt, enabled, identity, kind, learnerId, session, historyActivated, selection, requested]);

  const current: AttendanceState = state.identity === identity ? state : { identity, data: null, status: enabled && identity && (!session || historyActivated) ? 'loading' : 'idle', error: null };
  return {
    data: current.data,
    loading: current.status === 'loading' || Boolean(session && requested && !current.historyLoaded && current.status !== 'error'),
    error: current.error,
    retry,
    invalidate: retry,
    projection: current.projection,
    selection,
    setSelection,
  };
}
