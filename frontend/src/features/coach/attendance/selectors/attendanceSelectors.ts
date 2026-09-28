import type { CoachAttendanceLearner, CoachAttendanceRecord, CoachAttendanceSession } from '../types/attendance.types';

export function selectAttendanceLearner(learners: CoachAttendanceLearner[], learnerId: string) {
  return learners.find(row => String(row.id) === String(learnerId)) || null;
}

export function selectRecentAttendance(records: CoachAttendanceRecord[], learnerId: string) {
  return records
    .filter(row => row.learnerId === learnerId && (row.status === 'present' || row.status === 'absent'))
    .sort((a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || ''))
    .slice(0, 4);
}

export function selectRecordedAttendance(sessions: CoachAttendanceSession[]) {
  return sessions.filter(row => row.status === 'present' || row.status === 'absent');
}

export function formatAttendancePercentage(value: number | null | undefined) {
  return value === null || value === undefined ? '--' : `${value}%`;
}

