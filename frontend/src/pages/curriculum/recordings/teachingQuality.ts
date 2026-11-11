import { coachFetch } from '@/lib/coachFetch';
import { learningFetch } from '@/lib/personalLearning';
import { invalidateQualityReviews, QualityReviewError, type QualityContext, type QualityForm, type QualityReview } from '@/api/coachingQualityReviews';

export interface TeachingLectureScope { moduleId: string; seriesId: string; occurrenceId: string }
const url = (scope: TeachingLectureScope) => `/curriculum_api/curriculum/session-recordings/quality/?${new URLSearchParams({ ...scope })}`;

async function request<T>(scope: TeachingLectureScope, init: RequestInit): Promise<T> {
  const response = await (init.method ? coachFetch : learningFetch)(url(scope), { ...init, signal: init.signal ?? AbortSignal.timeout(20000), credentials: 'include', cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new QualityReviewError(value.error || 'The teaching review could not be loaded or saved.', response.status, value.code);
  return value as T;
}
export const teachingQualityContext = (scope: TeachingLectureScope, signal: AbortSignal) => request<QualityContext>(scope, { signal });
export async function saveTeachingQualityReview(scope: TeachingLectureScope, payload: {
  templateVersion: number; expectedVersion: number; requestId: string; status: 'draft' | 'completed'; form: QualityForm;
}) {
  const result = await request<{ review: QualityReview; document?: QualityReview['document'] }>(scope,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, reviewType: 'FORM_TEACHING' }) });
  invalidateQualityReviews();
  return { ...result.review, ...(result.document ? { document: result.document } : {}) };
}
