import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';

/** Preserve the exact meeting identity when explicitly opening its Calendar. */
export function meetingCalendarHref(session: LearnerCalendarEvent, learner: { kind: string; id: string }, action?: 'schedule' | 'reschedule', attendance?: MeetingAttendance): string {
  const params = new URLSearchParams({ kind: learner.kind, learner: learner.id });
  params.set('event', attendance?.calendarEventKey || session.eventKey || session.id);
  const date = session.scheduledDate || session.targetDate || session.date;
  if (date) params.set('date', date);
  if (session.importedReview) {
    params.set('reviewId', session.importedReview.id);
    params.set('source', session.source);
  }
  if (action) params.set('action', action);
  return `/learner/calendar?${params}`;
}

export function meetingBookingWarning(event: LearnerCalendarEvent, responseWarning?: string): string {
  if (responseWarning?.trim()) return responseWarning.trim();
  if (event.syncWarning?.trim()) return event.syncWarning.trim();
  if (event.syncError || (event.invited === false && ['scheduled', 'in-progress'].includes(event.status))) {
    return 'Your meeting time is saved in the LMS calendar, but the Microsoft calendar invitation has not been sent. Contact your programme team to complete calendar sync.';
  }
  return '';
}
