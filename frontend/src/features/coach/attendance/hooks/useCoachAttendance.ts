import { useCallback, useEffect, useState } from 'react';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
import { fetchCoachAttendance } from '../api/attendanceApi';
import type { CoachAttendanceLearner, CoachAttendanceRecord } from '../types/attendance.types';

export function useCoachAttendance(enabled: boolean) {
  const coach = useCoachIdentity();
  const cacheKey = coachSessionKey('attendance', coach.email);
  const initialCache = readCoachSessionCache<{ learners: CoachAttendanceLearner[]; records: CoachAttendanceRecord[] }>(cacheKey);
  const [learners, setLearners] = useState<CoachAttendanceLearner[]>(() => initialCache?.learners || []);
  const [records, setRecords] = useState<CoachAttendanceRecord[]>(() => initialCache?.records || []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState<string | null>(null);
  const replaceAttendance = useCallback((updates: CoachAttendanceRecord[]) => {
    setRecords(current => {
      const next = [...current];
      for (const update of updates) {
        const matches = (row: CoachAttendanceRecord) => row.learnerId === update.learnerId && row.sessionId === update.sessionId;
        const index = next.findIndex(matches);
        if (index < 0) next.push(update);
        else {
          next[index] = update;
          // Collapse old representations by occurrence identity, never by date.
          for (let i = next.length - 1; i > index; i--) if (matches(next[i])) next.splice(i, 1);
        }
      }
      const instant = (row: CoachAttendanceRecord) => Date.parse(row.occurrenceStart || `${row.sessionDate}T00:00:00Z`) || 0;
      next.sort((a, b) => instant(b) - instant(a) || b.sessionId.localeCompare(a.sessionId));
      writeCoachSessionCache(cacheKey, { learners, records: next });
      return next;
    });
  }, [cacheKey, learners]);
  const reload = useCallback(async () => {
    const payload = await fetchCoachAttendance();
    const next = { learners: payload.learners || [], records: payload.attendanceRecords || [] };
    writeCoachSessionCache(cacheKey, next);
    setLearners(next.learners); setRecords(next.records); setError(null);
  }, [cacheKey]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const cached = readCoachSessionCache<{ learners: CoachAttendanceLearner[]; records: CoachAttendanceRecord[] }>(cacheKey);
    if (cached) {
      setLearners(cached.learners); setRecords(cached.records); setLoading(false);
    } else setLoading(true);
    setError(null);
    fetchCoachAttendance(controller.signal).then(payload => {
      if (!controller.signal.aborted) {
        const next = { learners: payload.learners || [], records: payload.attendanceRecords || [] };
        writeCoachSessionCache(cacheKey, next);
        setLearners(next.learners); setRecords(next.records);
      }
    }).catch(reason => {
      if (!controller.signal.aborted && !cached) setError(reason instanceof Error ? reason.message : 'Unable to load attendance data.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cacheKey, enabled]);
  return { learners, records, loading, error, reload, replaceAttendance };
}

