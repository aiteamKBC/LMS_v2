import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCoachAttendanceDetails } from '../api/attendanceApi';
import { selectRecordedAttendance } from '../selectors/attendanceSelectors';
import type { CoachAttendanceLearner, CoachAttendanceSession } from '../types/attendance.types';

export function useAttendanceDetail(learnerId: string, enabled: boolean) {
  const [learner, setLearner] = useState<CoachAttendanceLearner | null>(null);
  const [sessions, setSessions] = useState<CoachAttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    async function load() {
      setLoading(true); setError(null);
      try {
        const details = await fetchCoachAttendanceDetails(learnerId, controller.signal);
        if (!details.learner) throw new Error('Learner attendance record was not found.');
        const summary = details.summary;
        const selected: CoachAttendanceLearner = {
          id: String(details.learner.id),
          learner: details.learner.name,
          email: details.learner.email,
          programme: details.learner.programme || '--',
          programmeId: details.learner.programmeId,
          cohort: details.learner.cohort || '--',
          group: details.learner.group || '--',
          groupId: details.learner.groupId,
          programStatus: details.learner.programStatus || undefined,
          attendance: summary?.attendanceRate ?? null,
          sessions: summary?.total || 0,
          present: summary?.present || 0,
          absent: summary?.absent || 0,
          learnerStartDate: details.learner.learnerStartDate,
          learnerEndDate: details.learner.learnerEndDate,
          programmeStartDate: details.learner.programmeStartDate,
          programmeEndDate: details.learner.programmeEndDate,
          coachName: details.learner.coachName,
        };
        if (!cancelled) {
          setLearner(selected);
          setSessions(details.sessions || []);
        }
      } catch (reason) {
        if (!cancelled) {
          if (timedOut) setError('Attendance details took too long to load. Please try again.');
          else if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load attendance profile.');
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; window.clearTimeout(timeoutId); controller.abort(); };
  }, [enabled, learnerId, revision]);
  const recorded = useMemo(() => selectRecordedAttendance(sessions), [sessions]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  return { learner, sessions, recorded, loading, error, reload };
}
