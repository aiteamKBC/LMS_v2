import type { LearnerCalendarEvent, LearnerReviewDefinition } from './learnerCalendar';
import type { LearnerKind } from './learnerDetail';

/** Only unfinished MCM and Progress Reviews may be initialized on open. */
export function needsLearnerMigratedForm(event: LearnerCalendarEvent | null): boolean {
  if (!event || event.migratedForm || !event.eventKey.startsWith('imported-review:')) return false;
  // Keep captured Aptem forms/history on their existing source path. The
  // canonical initializer refuses to replace them with a blank template.
  if (event.importedReview?.sections?.some(section =>
    Boolean(section.fields?.length || section.tables?.length || section.rawText?.trim()))) return false;
  const type = (event.importedReviewType || event.importedReview?.type || event.reviewTypeName || '').trim().toLowerCase();
  const supported = ['monthly coaching meeting', 'monthly coaching', 'mcm', 'progress review', 'progress review (+ skills radar)'];
  const normalize = (value?: string | null) => (value || '').trim().toLowerCase().replaceAll(' ', '-');
  const editable = ['not-scheduled', 'scheduled', 'in-progress'];
  return supported.includes(type) && editable.includes(normalize(event.status))
    && editable.includes(normalize(event.sourceStatus || event.importedReview?.status || event.status))
    && !event.reviewCompletedAt && !event.importedReview?.completedDate;
}

export async function prepareLearnerMigratedReview(eventKey: string, signal?: AbortSignal): Promise<LearnerReviewDefinition> {
  const csrfResponse = await fetch('/learner_api/migrated-reviews/csrf', { credentials: 'include', signal });
  const csrf = await csrfResponse.json() as { csrfToken?: string };
  if (!csrfResponse.ok || !csrf.csrfToken) throw new Error('Unable to verify this review request. Please try again.');
  const response = await fetch(`/learner_api/migrated-reviews/${encodeURIComponent(eventKey)}/prepare-review`, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf.csrfToken }, body: '{}',
  });
  const data = await response.json() as LearnerReviewDefinition & { detail?: string };
  if (!response.ok) throw new Error(data.detail || `Could not load this review (${response.status}).`);
  return data;
}

export async function previewLearnerMigratedReview(eventKey: string, kind: LearnerKind, learnerId: string, signal?: AbortSignal): Promise<LearnerReviewDefinition> {
  const response = await fetch(`/learner_api/migrated-reviews/${encodeURIComponent(eventKey)}/preview-review/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}`, { credentials: 'include', signal });
  const data = await response.json() as LearnerReviewDefinition & { detail?: string };
  if (!response.ok) throw new Error(data.detail || `Could not load this review (${response.status}).`);
  return data;
}
