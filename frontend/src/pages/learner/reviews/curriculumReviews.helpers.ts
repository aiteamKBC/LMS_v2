import { type LearnerCalendarEvent } from '@/api/learnerCalendar';


export function curriculumReviewTitle(review?: LearnerCalendarEvent | null): string {
  if (!review) return 'Review';
  if (review.importedReview) return review.importedReview.name || review.title || 'Review';
  const name = review.title || review.reviewTypeName || 'Review';
  const occurrence = review.occurrenceNumber ?? review.sequence;
  if (!review.reviewTemplateId) return name;
  return `${name}${occurrence != null ? ` #${occurrence}` : ' — Manual Review'}`;
}
