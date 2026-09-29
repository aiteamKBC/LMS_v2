import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';

export type TimelineStatus = 'planned' | 'scheduled' | 'attended' | 'missed';

/** Only the attendance sources can turn a booked meeting green or red. */
export function reviewTimelineStatus(event: LearnerCalendarEvent, attendance?: MeetingAttendance): TimelineStatus {
  if (attendance?.attendanceConfirmed || event.meetingOutcome === 'completed') return 'attended';
  if (attendance?.missed || attendance?.absenceReported || event.meetingOutcome === 'ended') return 'missed';
  const bookingStatus = (attendance?.status || event.bookingStatus || event.status).trim().toLowerCase().replace(/[ _]+/g, '-');
  if (['cancelled', 'deleted', 'superseded', 'failed', 'not-scheduled', 'planned', 'unknown'].includes(bookingStatus)) return 'planned';
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
  return reviewTimelineStatus(event, attendance);
}
