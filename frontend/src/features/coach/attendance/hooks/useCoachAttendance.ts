import { useEffect, useState } from 'react';
import { fetchCoachAttendance } from '../api/attendanceApi';
import type { CoachAttendanceLearner, CoachAttendanceRecord } from '../types/attendance.types';

export function useCoachAttendance(enabled: boolean) {
  const [learners, setLearners] = useState<CoachAttendanceLearner[]>([]);
  const [records, setRecords] = useState<CoachAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetchCoachAttendance(controller.signal).then(payload => {
      if (!controller.signal.aborted) { setLearners(payload.learners || []); setRecords(payload.attendanceRecords || []); }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load attendance data.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled]);
  return { learners, records, loading, error };
}

