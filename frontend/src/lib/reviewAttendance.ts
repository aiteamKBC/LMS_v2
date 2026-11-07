export type ReviewAttendance = 'attended' | 'missed' | 'pending' | 'unavailable' | null;

/** Display only: never used to grant booking, completion or attendance credit. */
export function reviewAttendanceResult(
  event: { reviewAttendance?: ReviewAttendance; meetingOutcome?: string | null; scheduledDate?: string | null; scheduledTime?: string | null },
  attendance?: { date: string | null; startTime: string | null; attendanceConfirmed: boolean; absenceReported: boolean; missed: boolean },
): ReviewAttendance {
  const current = attendance && attendance.date === event.scheduledDate
    && (!attendance.startTime || !event.scheduledTime || attendance.startTime.slice(0, 5) === event.scheduledTime.slice(0, 5))
    ? attendance : undefined;
  if (current?.attendanceConfirmed) return 'attended';
  if (event.reviewAttendance === 'attended') return 'attended';
  if (current?.absenceReported) return 'missed';
  // An explicit null means the current booking has not ended. The previous
  // appointment's attendance response must not colour its replacement red.
  if (event.reviewAttendance !== undefined) return event.reviewAttendance;
  // Compatibility for older payloads; a missing report is not inferred here.
  if (event.meetingOutcome === 'completed') return 'attended';
  if (current?.missed || event.meetingOutcome === 'ended') return 'missed';
  return null;
}
