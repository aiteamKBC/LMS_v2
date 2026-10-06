import type { CoachAttendanceRecord, CoachAttendanceSession } from '../types/attendance.types';

export function selectRecentAttendance(records: CoachAttendanceRecord[], learnerId: string) {
  return records
    .filter(row => row.learnerId === learnerId && row.counted !== false && (row.status === 'present' || row.status === 'absent'))
    .slice(0, 4);
}

export function selectRecordedAttendance(sessions: CoachAttendanceSession[]) {
  return sessions.filter(row => row.status === 'unmarked' || (row.counted !== false && (row.status === 'present' || row.status === 'absent')));
}

export function formatAttendancePercentage(value: number | null | undefined) {
  return value === null || value === undefined ? '--' : `${value}%`;
}

