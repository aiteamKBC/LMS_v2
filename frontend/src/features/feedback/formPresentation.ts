import type { FeedbackAnswerValue, FeedbackNameAnswer, FeedbackPhotoAnswer, FeedbackQuestion, FeedbackSection } from '@/api/feedback';

export const FEEDBACK_SECTION_ICONS = [
  { value: 'ri-file-list-3-line', label: 'General' },
  { value: 'ri-user-line', label: 'Personal information' },
  { value: 'ri-book-open-line', label: 'Learning or book' },
  { value: 'ri-star-line', label: 'Experience' },
  { value: 'ri-chat-3-line', label: 'Comments' },
  { value: 'ri-lightbulb-line', label: 'Ideas' },
  { value: 'ri-graduation-cap-line', label: 'Education' },
  { value: 'ri-calendar-event-line', label: 'Event' },
  { value: 'ri-heart-line', label: 'Satisfaction' },
] as const;

export function missingRequiredQuestionIds(section: FeedbackSection | undefined, answers: Record<string, FeedbackAnswerValue>): Set<number> {
  return new Set((section?.questions || [])
    .filter(question => question.required && question.id && !isAnswerComplete(question, answers[String(question.id)]))
    .map(question => question.id!));
}

function isAnswerComplete(question: FeedbackQuestion, value: FeedbackAnswerValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (question.type === 'name') return isNameAnswer(value) && Boolean(value.firstName.trim() && value.lastName.trim());
  if (question.type === 'photo_upload') return isPhotoAnswer(value) && Boolean(value.uploadId);
  if (question.type === 'multiple_choice') return Array.isArray(value) && value.length > 0;
  if (question.type === 'email') return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  if (typeof value === 'string') return Boolean(value.trim());
  return true;
}

function isNameAnswer(value: FeedbackAnswerValue | undefined): value is FeedbackNameAnswer { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'firstName' in value && 'lastName' in value); }
function isPhotoAnswer(value: FeedbackAnswerValue | undefined): value is FeedbackPhotoAnswer { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'uploadId' in value); }
