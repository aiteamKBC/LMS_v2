import type { ReviewFieldDefinition } from '@/api/reviewInstances';

export type ReviewBookingFamily = 'mcm' | 'progress_review';
export type ReviewBookingRole = 'coach' | 'learner';

export const NEXT_MEETING_QUESTION = 'Please confirm that the next session has been booked through the coaching booking system.';
export const NEXT_MEETING_SEMANTIC_KEY = 'next_review_booking_confirmation';

export function reviewBookingFamily(code: string | null | undefined): ReviewBookingFamily | null {
  if (code === 'mcm' || code === 'aptem_mcm') return 'mcm';
  if (code === 'progress_review' || code === 'aptem_progress_review') return 'progress_review';
  return null;
}

export function isNextMeetingQuestion(field: ReviewFieldDefinition, family: string | null | undefined) {
  return Boolean(reviewBookingFamily(family))
    && (field.fieldType === 'boolean' || field.fieldType === 'boolean_case_block')
    && (field.configuration?.semanticKey === NEXT_MEETING_SEMANTIC_KEY
      || field.title.trim().toLowerCase() === NEXT_MEETING_QUESTION.toLowerCase());
}

export function nextReviewBookingUrl(role: ReviewBookingRole, family: ReviewBookingFamily, currentInstanceId: string) {
  const path = role === 'coach'
    ? family === 'mcm' ? '/coach/monthly-coaching' : '/coach/progress-reviews'
    : family === 'mcm' ? '/learner/monthly-coaching' : '/learner/progress-reviews';
  return `${path}?${new URLSearchParams({ bookNextAfter: currentInstanceId })}`;
}

export interface NextBookingEvent {
  id: string;
  eventKey?: string | null;
  formEventKey?: string | null;
  reviewInstanceId?: string | null;
  reviewTemplateId?: string | null;
  learnerId?: string | number | null;
  reviewTypeCode?: string | null;
  importedReviewType?: string | null;
  source?: string;
  reviewSource?: string | null;
  occurrenceNumber?: number | null;
  targetDate?: string | null;
  date?: string | null;
  status: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  bookingStatus?: string | null;
  syncState?: string | null;
  calendarEventKey?: string | null;
  meetingLink?: string | null;
  bookingReserved?: boolean;
}

export type NextBookingResult<T> =
  | { kind: 'book'; event: T }
  | { kind: 'booked'; event: T }
  | { kind: 'unavailable'; reason: string };

const dateOf = (event: NextBookingEvent) => event.targetDate || event.date || '';

/** Select only the immediate next occurrence of the same review for this learner. */
export function nextReviewBooking<T extends NextBookingEvent>(events: T[], currentInstanceId: string): NextBookingResult<T> {
  const current = events.find(event => [event.id, event.eventKey, event.formEventKey, event.reviewInstanceId]
    .some(key => key === currentInstanceId));
  if (!current) return { kind: 'unavailable', reason: 'This review could not be matched to the booking calendar. Refresh the page and try again.' };

  const candidates = events.filter(event => {
    if (event === current || event.source !== current.source) return false;
    if (current.learnerId != null && String(event.learnerId) !== String(current.learnerId)) return false;
    if (current.reviewTemplateId) {
      if (event.reviewTemplateId !== current.reviewTemplateId) return false;
    } else if (current.importedReviewType) {
      if (event.importedReviewType !== current.importedReviewType) return false;
    } else if (current.reviewTypeCode && event.reviewTypeCode !== current.reviewTypeCode) return false;
    if (current.occurrenceNumber != null && event.occurrenceNumber != null) {
      return event.occurrenceNumber > current.occurrenceNumber;
    }
    return Boolean(dateOf(current) && dateOf(event) && dateOf(event) > dateOf(current));
  });
  const useOccurrenceOrder = current.occurrenceNumber != null
    && candidates.every(event => event.occurrenceNumber != null);
  candidates.sort((a, b) => (useOccurrenceOrder
    ? (a.occurrenceNumber ?? 0) - (b.occurrenceNumber ?? 0) : 0)
    || dateOf(a).localeCompare(dateOf(b))
    || (a.occurrenceNumber ?? 0) - (b.occurrenceNumber ?? 0));
  const next = candidates[0];
  if (!next) return { kind: 'unavailable', reason: 'No later meeting of this review type is available to book yet.' };
  const bookingState = next.bookingStatus || next.status;
  const hasBookedTime = Boolean(next.scheduledDate && next.scheduledTime);
  if (next.bookingReserved === true || (next.bookingReserved !== false && hasBookedTime
      && (['scheduled', 'in-progress', 'awaiting-signature', 'completed'].includes(bookingState)
        || ['syncing', 'reconciliation'].includes(next.syncState || '')
        || Boolean(next.calendarEventKey && next.meetingLink)))) {
    return { kind: 'booked', event: next };
  }
  if (next.status === 'not-scheduled' || (next.status === 'scheduled'
      && (next.reviewSource === 'aptem' || next.bookingReserved === false))) {
    return { kind: 'book', event: next };
  }
  return { kind: 'unavailable', reason: 'The next meeting cannot be booked in its current state.' };
}
