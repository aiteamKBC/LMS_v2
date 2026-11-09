import type { AttendanceStatus } from '@/types/bulkAttendance';

export function attendanceOutcome(record: {
  attendance: AttendanceStatus | null;
  effectiveAttendance?: 'present' | 'awaiting_recording';
  attendanceBasis?: 'recorded' | 'awaiting_recording';
}): AttendanceStatus {
  return record.attendanceBasis ?? record.effectiveAttendance ?? record.attendance ?? 'unmarked';
}

export function isAttendancePresent(status: AttendanceStatus): boolean {
  return status === 'present' || status === 'recorded';
}

export function attendanceStatusLabel(status: AttendanceStatus): string {
  if (status === 'recorded') return 'Recording completed';
  if (status === 'awaiting_recording') return 'Awaiting recording';
  if (status === 'present') return 'Present';
  if (status === 'absent') return 'Absent';
  return 'Unmarked';
}

export function recordingStatusStyle(status: AttendanceStatus) {
  return status === 'recorded' || status === 'awaiting_recording'
    ? { className: 'border-pink-200 bg-pink-100 text-pink-800',
        icon: status === 'recorded' ? 'ri-video-line' : 'ri-time-line', label: attendanceStatusLabel(status) }
    : null;
}
