import type { CoachCalendarEvent } from './calendarEvents';

export function importedReviewFormPath(event: CoachCalendarEvent) {
  const kind = event.learnerType || 'apprenticeship';
  const learnerId = event.enrolmentId || event.learnerId || '';
  const reviewId = event.aptemReviewId || '';
  return `/coach/imported-review-forms/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}/${encodeURIComponent(reviewId)}`;
}
