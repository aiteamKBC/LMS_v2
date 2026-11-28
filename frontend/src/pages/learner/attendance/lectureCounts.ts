import type { AttendanceLecture } from '@/api/attendanceLectures';

export function isAttendedLecture(row: AttendanceLecture): boolean {
  if (row.counted === false) return false;
  if (row.liveAttendanceStatus != null) return row.liveAttendanceStatus === 'present';
  return row.attendanceBasis !== 'recorded' && (['completed', 'late'].includes(row.status)
    || (row.status === 'absent' && row.effectiveAttendance === 1));
}

export function isAbsentLecture(row: AttendanceLecture): boolean {
  if (row.counted === false) return false;
  return row.liveAttendanceStatus != null ? row.liveAttendanceStatus === 'absent'
    : row.status === 'absent' && !isAttendedLecture(row);
}

export function lectureCounts(lectures: AttendanceLecture[]) {
  const attended = lectures.filter(isAttendedLecture).length;
  const absent = lectures.filter(isAbsentLecture).length;
  return { all: lectures.length, attended, absent,
    covered: lectures.filter(row => row.catchupStatus === 'completed').length,
    upcoming: lectures.filter(row => row.status === 'upcoming').length,
    rate: attended + absent ? Math.round(100 * attended / (attended + absent)) : null };
}
