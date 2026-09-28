import { useEffect, useMemo, useState } from 'react';
import { fetchCoachAttendance, fetchCoachAttendanceDetails } from '../api/attendanceApi';
import { selectAttendanceLearner, selectRecordedAttendance } from '../selectors/attendanceSelectors';
import type { CoachAttendanceLearner, CoachAttendanceSession } from '../types/attendance.types';

export function useAttendanceDetail(learnerId: string, enabled: boolean) {
  const [learner, setLearner] = useState<CoachAttendanceLearner | null>(null);
  const [sessions, setSessions] = useState<CoachAttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        const overview = await fetchCoachAttendance();
        const selected = selectAttendanceLearner(overview.learners || [], learnerId);
        if (!selected) throw new Error('Learner attendance record was not found.');
        const details = await fetchCoachAttendanceDetails(String(selected.id));
        if (!cancelled) {
          setLearner(selected);
          setSessions((details.sessions || []).sort((a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || '')));
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load attendance profile.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [enabled, learnerId]);
  const recorded = useMemo(() => selectRecordedAttendance(sessions), [sessions]);
  return { learner, sessions, recorded, loading, error };
}
