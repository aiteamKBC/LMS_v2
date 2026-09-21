import type { ImportedReview } from './reviewHistory';
import { coachFetch } from '@/lib/coachFetch';
import type { CoachCalendarEvent, CoachCalendarStatus } from '@/pages/coach/shared/calendarEvents';

export interface CoachImportedReviewLearner {
  id: string;
  aptemId: string;
  name: string;
  email?: string | null;
  learnerType: 'commercial' | 'apprenticeship';
  enrolmentId?: string | null;
  mcm: ImportedReview[];
  reviews: ImportedReview[];
}

export async function fetchCoachImportedReviews(signal?: AbortSignal) {
  const response = await coachFetch('/coach_api/coach/imported-review-history', { signal });
  const payload = await response.json().catch(() => ({})) as {
    learners?: CoachImportedReviewLearner[];
    detail?: string;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load imported reviews.');
  return payload.learners || [];
}

function importedReviewStatus(status: string, completedDate: string | null): CoachCalendarStatus {
  if (completedDate || status.toLowerCase() === 'completed') return 'completed';
  const normalized = status.toLowerCase().replaceAll('_', '-') as CoachCalendarStatus;
  return ['scheduled', 'in-progress', 'awaiting-signature', 'confirmed', 'pending', 'cancelled', 'not-scheduled'].includes(normalized)
    ? normalized
    : 'not-scheduled';
}

export function importedReviewEvents(
  learners: CoachImportedReviewLearner[],
  category: 'mcm' | 'reviews',
): CoachCalendarEvent[] {
  return learners.flatMap((learner) => (category === 'mcm' ? learner.mcm : learner.reviews).map((review) => {
    const reviewDate = review.completedDate || review.plannedDate || undefined;
    return {
      id: `imported-review:${review.id}`,
      eventKey: `imported-review:${review.id}`,
      title: review.name || review.type || 'Imported review',
      type: category === 'mcm' ? 'coaching' : 'review',
      source: category === 'mcm' ? 'mcr' : 'progress-review',
      status: importedReviewStatus(review.status, review.completedDate),
      date: reviewDate,
      targetDate: review.plannedDate || review.completedDate || undefined,
      scheduledDate: review.completedDate || review.plannedDate,
      scheduledTime: review.plannedTime,
      learner: learner.name,
      email: learner.email || undefined,
      learnerId: learner.id,
      learnerType: learner.learnerType,
      enrolmentId: learner.enrolmentId,
      notes: review.reviewerName ? `Reviewer: ${review.reviewerName}` : undefined,
    };
  }));
}

export function isImportedReviewEvent(event: CoachCalendarEvent) {
  return event.id.startsWith('imported-review:') || event.eventKey?.startsWith('imported-review:') === true;
}
