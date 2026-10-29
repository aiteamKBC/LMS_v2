import type { LearnerCalendarEvent } from '@/api/learnerCalendar';

export function shouldShowLearnerMeetingRecording(session?: LearnerCalendarEvent | null): boolean {
  return Boolean(
    session?.eventKey
    && session?.meetingLink
    && (session.reviewSource === 'aptem'
      ? session.calendarEventKey
      : ['completed', 'awaiting-signature'].includes(session.status)),
  );
}
