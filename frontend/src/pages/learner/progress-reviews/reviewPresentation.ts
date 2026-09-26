import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { featuredSession, meetingJoinUrl, meetingStatus } from '../reviews/featuredSession';

export type ReviewFilter = 'all' | 'upcoming' | 'past';
export type ReviewDefinitions = Readonly<Record<string, LearnerReviewDefinition | null>>;
export interface ReviewPresentation {
  session: LearnerCalendarEvent;
  attendance?: MeetingAttendance;
  status: string;
  date: string | null;
  booked: boolean;
  isToday: boolean;
  past: boolean;
  needsAttention: boolean;
  label: string;
  description: string;
  action: 'schedule' | 'join' | 'sign' | 'view';
  joinUrl: string | null;
  canReschedule: boolean;
}

/** Display state only. Keep the original event for all existing action handlers. */
export function presentReview(session: LearnerCalendarEvent, attendance: MeetingAttendance | undefined, today: string, definition?: LearnerReviewDefinition | null): ReviewPresentation {
  const storedStatus = meetingStatus(session);
  const bookingStatus = (attendance?.status || session.bookingStatus || storedStatus).trim().toLowerCase().replace(/[ _]+/g, '-');
  const submittedStatus = definition?.instance?.status;
  const cancelled = storedStatus === 'cancelled' || ['cancelled', 'deleted', 'superseded'].includes(bookingStatus);
  const status = cancelled ? 'cancelled' : ['awaiting-signature', 'completed'].includes(submittedStatus || '') ? submittedStatus!
    : ['awaiting-signature', 'completed'].includes(storedStatus) ? storedStatus : bookingStatus;
  const scheduledDate = attendance ? attendance.date : session.scheduledDate;
  const date = scheduledDate || session.targetDate || session.date || null;
  const booked = !session.importedReview && Boolean(scheduledDate) && ['scheduled', 'in-progress'].includes(status)
    && !['not-scheduled', 'planned', 'failed', 'unknown'].includes(bookingStatus);
  const isToday = booked && scheduledDate === today;
  const joinUrl = booked ? meetingJoinUrl({ ...session, meetingLink: attendance ? attendance.meetingLink : session.meetingLink }) : null;
  const base = { session, attendance, status, date, booked, isToday, joinUrl,
    canReschedule: booked && status === 'scheduled' && !attendance?.attendanceConfirmed };
  const result = (label: string, description: string, action: ReviewPresentation['action'], past = false, needsAttention = false): ReviewPresentation =>
    ({ ...base, label, description, action, past, needsAttention });

  if (cancelled) return result('Cancelled', 'This review was cancelled. Its record is still available.', 'view', true);
  if (session.importedReview) return result(status === 'completed' ? 'Completed' : 'Archived review', 'You can read this saved review and its attachments.', 'view', true);
  if (['awaiting-signature', 'completed'].includes(status)) {
    // Match the existing detail form's signature eligibility. A calendar status
    // alone cannot establish whose signature is required by a Curriculum form.
    const instanceBacked = Boolean(session.reviewTemplateId || session.reviewInstanceId);
    const submitted = ['awaiting-signature', 'completed'].includes(definition?.instance?.status || '');
    const learnerNeedsToSign = instanceBacked
      ? submitted && definition?.signatures.participant?.required && !definition.signatures.participant.signed
      : !session.learnerSigned;
    if (learnerNeedsToSign) return result('Your signature is needed', "Read your coach's notes and the agreed next steps, then sign the review.", 'sign', true, true);
    if (definition && submitted) {
      const pending = Object.values(definition.signatures).some(item => item.required && !item.signed);
      if (pending) return result('Waiting for other signatures', definition.signatures.participant?.signed
        ? 'Your signature is saved. No further signature is needed from you.' : 'Other participants still need to sign. No signature is needed from you.', 'view', true);
    }
    if (status === 'awaiting-signature' && !definition) return result('Check review signatures', 'Open the review to see which signatures are still needed.', 'view', true, true);
    return result(status === 'completed' ? 'Completed' : 'Review available', 'You can read your review and the agreed next steps.', 'view', true);
  }
  if (attendance?.attendanceConfirmed) return result('Attendance recorded', 'Your attendance is saved. Open the review to check the latest notes.', 'view', Boolean(date && date < today));
  if (attendance?.missed || attendance?.absenceReported) return result(attendance.absenceReported ? 'Absence reported' : 'Meeting missed', 'Open the meeting options to check your next step with your coach.', 'view', Boolean(date && date < today), true);
  if (booked && date && date < today) return result('Awaiting update', 'Open this review to check its attendance and next steps.', 'view', true, true);
  if (booked) return result(isToday ? 'Today' : status === 'in-progress' ? 'In progress' : 'Scheduled',
    'Have your learning updates and questions ready for your coach.', isToday && joinUrl ? 'join' : 'view');
  if (['not-scheduled', 'planned'].includes(status)) return result('Not scheduled', 'Choose a date and time with your coach. The target date is not a confirmed appointment.', 'schedule', false, Boolean(date && date < today));
  return result('Check review details', 'Open the review to check its current details.', 'view', Boolean(date && date < today));
}

export function reviewOverview(sessions: readonly LearnerCalendarEvent[], attendance: readonly MeetingAttendance[], today: string, definitions: ReviewDefinitions = {}) {
  const all = sessions.map(session => presentReview(session,
    attendance.find(item => item.id === session.id) || attendance.find(item => Boolean(item.calendarEventKey) && item.calendarEventKey === session.eventKey),
    today, definitions[session.eventKey] || definitions[session.id]));
  // Reuse the existing featured-meeting ordering; never alter the programme
  // dates, persisted statuses, booking rules or the input event objects.
  const featured = featuredSession(all.filter(item => !item.past)
    .map(item => ({ ...item.session, status: item.status, scheduledDate: item.booked ? item.date : null,
      scheduledTime: item.attendance?.startTime ?? item.session.scheduledTime })), today);
  const attention = all.filter(item => item.needsAttention);
  const current = all.find(item => item.session.id === featured?.id) || attention[0] || null;
  return { all, attention, current, upcoming: all.filter(item => !item.past), past: all.filter(item => item.past).reverse() };
}

/** Only carry recognised presentation parameters; identity always comes from the resolved learner. */
export function reviewsListHref(learner: { kind: string; id: string }, params: URLSearchParams, basePath = '/learner/progress-reviews') {
  const next = new URLSearchParams({ kind: learner.kind, learner: learner.id });
  if (params.get('view') === 'all') {
    next.set('view', 'all');
    const filter = params.get('filter');
    if (filter === 'all' || filter === 'upcoming' || filter === 'past') next.set('filter', filter);
    const page = params.get('page');
    if (page && /^\d+$/.test(page) && Number.isSafeInteger(Number(page)) && Number(page) > 0) next.set('page', page);
  }
  return `${basePath}?${next}`;
}
