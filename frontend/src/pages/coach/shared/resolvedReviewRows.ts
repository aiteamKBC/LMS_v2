import type { CoachCalendarEvent, CoachCalendarStatus } from './calendarEvents';
import { canJoinMeeting, eventIdentity, hasScheduledSlot } from './calendarEvents';

export type NormalizedReviewStatus =
  | 'not-scheduled'
  | 'scheduled'
  | 'in-progress'
  | 'awaiting-signature'
  | 'completed';

export interface ReviewActionMatrix {
  schedule: 'Schedule' | 'Reschedule' | null;
  view: true;
  viewForm: boolean;
  presentation: boolean;
  join: boolean;
}

/** Normalize source statuses only after both adapters have produced the common event contract. */
export function normalizedReviewStatus(event: CoachCalendarEvent): NormalizedReviewStatus {
  if (event.status === 'completed') return 'completed';
  if (event.status === 'awaiting-signature') return 'awaiting-signature';
  if (event.status === 'in-progress') return 'in-progress';
  if (event.status === 'scheduled') return 'scheduled';
  // Confirmed is a booking acknowledgement, never evidence of completion. It
  // is Scheduled only when the common row contains a real date and time.
  if (event.status === 'confirmed') return hasScheduledSlot(event) ? 'scheduled' : 'not-scheduled';
  return 'not-scheduled';
}

export function normalizeResolvedReview(event: CoachCalendarEvent): CoachCalendarEvent {
  return { ...event, status: normalizedReviewStatus(event) as CoachCalendarStatus };
}

/** Stable event/review keys are the only deduplication identity used here. */
export function normalizeResolvedReviews(events: CoachCalendarEvent[]) {
  const byStableId = new Map<string, CoachCalendarEvent>();
  for (const event of events) {
    const key = eventIdentity(event).trim();
    if (key && !byStableId.has(key)) byStableId.set(key, normalizeResolvedReview(event));
  }
  return [...byStableId.values()];
}

export function reviewActionMatrix(event: CoachCalendarEvent): ReviewActionMatrix {
  const status = normalizedReviewStatus(event);
  const aptemFormAvailable = event.reviewSource === 'aptem' && Boolean(event.hasReviewForm && event.aptemReviewId);
  const curriculumFormAvailable = event.reviewSource !== 'aptem'
    && Boolean(event.reviewInstanceId || event.reviewTemplateId);
  return {
    schedule: status === 'not-scheduled' ? 'Schedule' : status === 'scheduled' ? 'Reschedule' : null,
    view: true,
    viewForm: aptemFormAvailable || curriculumFormAvailable,
    presentation: Boolean(event.enrolmentId),
    join: canJoinMeeting({ ...event, status }),
  };
}
