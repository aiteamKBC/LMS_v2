import { useCallback, useEffect, useState } from 'react';
import { acquireAttendanceDetail, attendanceDetailKey, invalidateAttendanceDetail } from '../api/attendanceDetailCache';
import type { CoachAttendanceLearner, CoachAttendanceDetailsPayload } from '../types/attendance.types';

export function useAttendanceDetail(learnerId: string, enabled: boolean, scope: string) {
  const context = JSON.stringify([scope, learnerId]);
  const [selection, setSelection] = useState({ context, page: 1 });
  const page = selection.context === context ? selection.page : 1;
  const key = attendanceDetailKey(scope, learnerId, page);
  const setPage = useCallback((next: number) => setSelection({ context, page: next }), [context]);
  const [learner, setLearner] = useState<CoachAttendanceLearner | null>(null);
  const [payload, setPayload] = useState<CoachAttendanceDetailsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setLearner(null); setPayload(null); setError(null);
    if (!enabled || !learnerId) { setLoading(false); return; }
    const request = acquireAttendanceDetail(key);
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        const details = await request.promise;
        if (!details.learner) throw new Error('Learner attendance record was not found.');
        const summary = details.summary;
        const selected: CoachAttendanceLearner = {
          id: String(details.learner.id),
          learner: details.learner.name,
          email: details.learner.email,
          programme: details.learner.programme || '--',
          cohort: details.learner.cohort || '--',
          group: details.learner.group || '--',
          attendance: summary?.attendanceRate ?? null,
          sessions: summary?.sessions || 0,
          present: summary?.present || 0,
          absent: summary?.absent || 0,
          learnerStartDate: details.learner.learnerStartDate,
          learnerEndDate: details.learner.learnerEndDate,
        };
        if (!cancelled) {
          setLearner(selected);
          setPayload(details);
        }
      } catch (reason) {
        if (!cancelled) {
          if (!(reason instanceof Error && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'Unable to load attendance profile.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; request.release(); };
  }, [enabled, learnerId, key, revision]);
  const reload = useCallback(() => {
    invalidateAttendanceDetail(key);
    setPage(1);
    setRevision(value => value + 1);
  }, [key, setPage]);
  return { learner, recorded: payload?.records || [], coach: payload?.coach, tutor: payload?.tutor,
    pagination: payload?.pagination, page, setPage, loading, error, reload, key, scope };
}
