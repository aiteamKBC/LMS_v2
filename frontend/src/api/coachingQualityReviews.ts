import { learningFetch } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import { createCachedResource } from './cachedRequest';
import { withCallerSignal } from './learnerRead';

export type Rating = '' | 'gold' | 'green' | 'amber' | 'red' | 'na';
export interface QualityTemplate {
  id: string; title: string; ratings: Record<Exclude<Rating, ''>, string>;
  sections: { id: string; title: string; screenshots: boolean; criteria: { id: string; text: string }[] }[];
}
export interface QualityForm {
  header: { employer: string; programme: string; activityDate: string; startDate: string; endDate: string };
  criteria: Record<string, { rating: Rating; evidence: string }>;
  actions: { action: string; outcome: string; supportedBy: string; dueDate: string }[];
  images: Record<string, string[]>; sources: string[];
}
export interface QualityReview {
  id: string; version: number; templateId: string; identity: string; status: 'draft' | 'completed'; form: QualityForm;
  coach: { email: string; name: string }; learner: { id: string; name: string; email?: string };
  meeting: { eventId: string; onlineMeetingId?: string; startsAt: string; endsAt: string; title: string };
  reviewer: { id: string; name: string; email: string }; updatedAt: string; updatedBy: string;
}
export interface QualityContext {
  template: QualityTemplate; learners: { id: string; name: string }[]; review: QualityReview | null;
  snapshot: Pick<QualityReview, 'coach' | 'meeting'> & { learner: QualityReview['learner'] | null };
  observer: QualityReview['reviewer'];
}
export interface QualitySummary {
  id: string; coachEmail: string; coachName: string; learnerId: string; learnerName: string;
  startsAt: string; status: 'draft' | 'completed'; version: number; updatedAt: string; title: string; actionCount: number;
}
export interface ReviewList { reviews: QualitySummary[]; coaches: { email: string; name: string }[]; nextOffset: number | null }
const base = '/coach_api/coaching-recordings/quality';
export class QualityReviewError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await (init.method ? coachFetch : learningFetch)(url, { ...init, credentials: 'include', cache: 'no-store', signal: controller.signal });
    const value = await response.json() as { error?: string };
    if (!response.ok) throw new QualityReviewError(value.error || 'The quality review could not be loaded or saved.', response.status);
    return value as T;
  } catch (error) {
    if (controller.signal.aborted) throw new QualityReviewError('This request took too long. Your edits are still here; retry the save.', 503);
    throw error;
  } finally { clearTimeout(timer); }
}
const reads = createCachedResource<unknown>('coaching-quality-reviews', url => request(url), 15000, 16);
export function invalidateQualityReviews() { reads.invalidate(); }
async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  return await withCallerSignal(reads.read(url), signal) as T;
}
export function qualityContext(eventKey: string, reference?: string, learnerId = '', signal?: AbortSignal): Promise<QualityContext> {
  const params = new URLSearchParams({ eventKey, learnerId });
  if (reference) params.set('reference', reference);
  return read(`${base}/context?${params}`, signal);
}
export function qualityReview(id: string, signal?: AbortSignal) {
  return read<{ review: QualityReview; template: QualityTemplate }>(`${base}/reviews/${encodeURIComponent(id)}`, signal);
}
export function qualityReviews(filters: { start: string; end: string; coachEmail: string; status: string; timeZone: string; search: string }, offset = 0, signal?: AbortSignal) {
  return read<ReviewList>(`${base}/reviews?${new URLSearchParams({ ...filters, offset: String(offset) })}`, signal);
}
export async function saveQualityReview(payload: { learnerId: string; expectedVersion: number; requestId: string; status: string; form: QualityForm },
  id?: string, eventKey = '', reference?: string) {
  const params = new URLSearchParams({ eventKey });
  if (reference) params.set('reference', reference);
  const result = await request<{ review: QualityReview }>(`${base}/reviews${id ? `/${encodeURIComponent(id)}` : `?${params}`}`,
    { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  reads.invalidate();
  return result.review;
}
export async function uploadQualityImage(reviewId: string, section: string, image: File) {
  const data = new FormData(); data.set('section', section); data.set('image', image);
  return request<{ id: string }>(`${base}/reviews/${encodeURIComponent(reviewId)}/images`, { method: 'POST', body: data });
}
export const qualityImageUrl = (reviewId: string, imageId: string) => `${base}/reviews/${encodeURIComponent(reviewId)}/images/${encodeURIComponent(imageId)}`;
const pdfs = createCachedResource<Blob>('coaching-quality-pdfs', async url => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await learningFetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new Error('The saved review PDF is not available. Save a completed review and retry.');
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The service did not return a valid PDF.');
    return blob;
  } finally { clearTimeout(timer); }
}, 30000, 3);
export function qualityPdf(review: QualityReview) { return pdfs.read(`${base}/reviews/${encodeURIComponent(review.id)}/pdf?version=${review.version}`); }
