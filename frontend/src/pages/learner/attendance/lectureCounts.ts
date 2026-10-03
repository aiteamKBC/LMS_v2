import type { AttendanceLecture } from '@/api/attendanceLectures';

export function lectureCounts(lectures: AttendanceLecture[]) {
  // A missed lecture made up by a completed catch-up or attended alternative counts as attended.
  const madeUp = (row: AttendanceLecture) => row.status === 'absent' && row.effectiveAttendance === 1;
  const attended = lectures.filter(row => row.counted !== false && (['completed', 'late'].includes(row.status) || madeUp(row))).length;
  const absent = lectures.filter(row => row.counted !== false && row.status === 'absent' && !madeUp(row)).length;
  return { all: lectures.length, attended, absent,
    covered: lectures.filter(row => row.catchupStatus === 'completed').length,
    upcoming: lectures.filter(row => row.status === 'upcoming').length,
    rate: attended + absent ? Math.round(100 * attended / (attended + absent)) : null };
}
