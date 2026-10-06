import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';

export type TimelineStatus = 'planned' | 'scheduled' | 'in-progress' | 'attended' | 'missed';

/** Only the attendance sources can turn a booked meeting green or red. */
export function reviewTimelineStatus(event: LearnerCalendarEvent, attendance?: MeetingAttendance): TimelineStatus {
  if (attendance?.attendanceConfirmed || event.meetingOutcome === 'completed') return 'attended';
  if (attendance?.missed || attendance?.absenceReported || event.meetingOutcome === 'ended') return 'missed';
  const attendanceStatus = (attendance?.status || '').trim().toLowerCase().replace(/[ _]+/g, '-');
  const eventBookingStatus = (event.bookingStatus || '').trim().toLowerCase().replace(/[ _]+/g, '-');
  const eventStatus = event.status.trim().toLowerCase().replace(/[ _]+/g, '-');
  const bookingStatus = attendanceStatus || eventBookingStatus || eventStatus;
  if (['cancelled', 'deleted', 'superseded', 'failed', 'not-scheduled', 'planned', 'unknown'].includes(bookingStatus)) return 'planned';
  // Attendance can lag the calendar row by one refresh. Preserve an explicit
  // in-progress state from either source instead of presenting it as merely
  // scheduled to the learner.
  if ([attendanceStatus, eventBookingStatus, eventStatus].includes('in-progress')) return 'in-progress';
  return event.scheduledDate ? 'scheduled' : 'planned';
}

/** Show a completed review in green even while calendar or attendance copies are stale. */
export function completedReviewTimelineStatus(
  event: LearnerCalendarEvent,
  attendance?: MeetingAttendance,
  reviewStatus?: string | null,
): TimelineStatus {
  if ([event.status, event.bookingStatus, attendance?.status, reviewStatus]
    .some(status => status?.trim().toLowerCase() === 'completed')) return 'attended';
  if ([event.status, event.bookingStatus, attendance?.status, reviewStatus]
    .some(status => status?.trim().toLowerCase().replace(/[ _]+/g, '-') === 'in-progress')) return 'in-progress';
  return reviewTimelineStatus(event, attendance);
}
