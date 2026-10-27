import { learningFetch } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import { createCachedResource } from './cachedRequest';
import { withCallerSignal } from './learnerRead';

export type Rating = '' | 'gold' | 'green' | 'amber' | 'red' | 'na';
export type QualityReviewType = string;
export type QualityFieldType = 'rating' | 'text' | 'textarea' | 'boolean' | 'single_choice' | 'checklist' | 'date' | 'number' | 'image' | 'file';
export interface QualityField { id: string; text: string; type?: QualityFieldType; required?: boolean; options?: string[]; help?: string; allowNa?: boolean; descriptors?: Partial<Record<Exclude<Rating, ''>, string>> }
export interface QualityFormCard { reviewType: string; title: string; group: string; published: boolean; revision: number; legacy: boolean }
export interface QualityEvidenceFile { id: string; section: string; filename: string; size: number; contentType: string; hasPreview: boolean }
export type QualityAnswer = string | number | boolean | null | string[];
export interface QualityTemplate {
  id: string; title: string; version?: number; actionsTitle?: string; reviewType?: QualityReviewType; ratings: Record<Exclude<Rating, ''>, string>;
  sections: { id: string; title: string; screenshots: boolean; criteria: QualityField[] }[];
}
export interface QualityTemplateState { id: string; reviewType?: QualityReviewType; revision: number; draft: QualityTemplate; published: QualityTemplate; publishedAt: string | null; updatedAt: string | null }
export interface QualityForm {
  header: { employer: string; programme: string; activityDate: string; startDate: string; endDate: string };
  criteria: Record<string, { rating: Rating; evidence: string }>;
  actions: { action: string; outcome: string; supportedBy: string; dueDate: string }[];
  images: Record<string, string[]>; sources: string[];
  answers?: Record<string, QualityAnswer>;
  attachments?: Record<string, string[]>;
}
export interface QualityReview {
  id: string; version: number; templateId: string; identity: string; reviewType?: QualityReviewType | ''; status: 'draft' | 'completed'; form: QualityForm;
  coach: { email: string; name: string }; learner: { id: string; name: string; email?: string };
  meeting: { eventId: string; onlineMeetingId?: string; startsAt: string; endsAt: string; title: string };
  reviewer: { id: string; name: string; email: string }; updatedAt: string; updatedBy: string;
  definition?: QualityTemplate;
  evidenceFiles?: QualityEvidenceFile[];
  document?: { state: 'ready' | 'failed'; version: number; message?: string } | null;
}
export interface QualityContext {
  template: QualityTemplate; learners: { id: string; name: string }[]; review: QualityReview | null;
  snapshot: Pick<QualityReview, 'coach' | 'meeting' | 'reviewType'> & { learner: QualityReview['learner'] | null };
  observer: QualityReview['reviewer'];
}
export interface QualitySummary {
  id: string; coachEmail: string; coachName: string; learnerId: string; learnerName: string;
  startsAt: string; status: 'draft' | 'completed'; version: number; updatedAt: string; title: string; actionCount: number;
  pdfVersion?: number | null; reviewType?: QualityReviewType | ''; formTitle?: string | null;
}
export interface ReviewList { reviews: QualitySummary[]; coaches: { email: string; name: string }[]; nextOffset: number | null }
export interface MeetingQualityCheck { id: string; learnerId: string; learnerName: string; reviewType?: QualityReviewType | ''; formTitle?: string | null; status: string; version: number; pdfVersion: number | null; updatedAt: string }
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
export function qualityForms(signal?: AbortSignal, editing = false) {
  return read<{ forms: QualityFormCard[] }>(`${base}/forms${editing ? '?editing=1' : ''}`, signal);
}
export async function createQualityForm(title: string, requestId: string) {
  const result = await request<{ template: QualityTemplateState }>(`${base}/forms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, requestId }) });
  reads.invalidate(); return result.template;
}
export function uploadQualityEvidence(reviewId: string, section: string, file: File) {
  const data = new FormData(); data.set('section', section); data.set('file', file);
  return request<QualityEvidenceFile>(`${base}/reviews/${encodeURIComponent(reviewId)}/files`, { method: 'POST', body: data });
}
export const qualityEvidenceFileUrl = (reviewId: string, id: string, preview = false) => `${base}/reviews/${encodeURIComponent(reviewId)}/files/${encodeURIComponent(id)}${preview ? '?preview=1' : ''}`;
export function qualityDefinition(signal?: AbortSignal, reviewType?: QualityReviewType) {
  return read<{ template: QualityTemplateState; fieldTypes: QualityFieldType[] }>(`${base}/form${reviewType ? `?reviewType=${reviewType}` : ''}`, signal);
}
export async function saveQualityDefinition(payload: { definition: QualityTemplate; expectedRevision: number; requestId: string; publish: boolean }) {
  const result = await request<{ template: QualityTemplateState }>(`${base}/form${payload.definition.reviewType ? `?reviewType=${payload.definition.reviewType}` : ''}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  reads.invalidate(); return result.template;
}
export function qualityContext(eventKey: string, reference?: string, learnerId = '', signal?: AbortSignal, reviewType?: QualityReviewType, titleType?: QualityReviewType): Promise<QualityContext> {
  const params = new URLSearchParams({ eventKey, learnerId });
  if (reference) params.set('reference', reference);
  if (reviewType) params.set('reviewType', reviewType);
  else if (titleType) params.set('titleType', titleType);
  return read(`${base}/context?${params}`, signal);
}
export function qualityReview(id: string, signal?: AbortSignal, reviewType?: QualityReviewType) {
  return read<{ review: QualityReview; reviewType?: QualityReviewType | ''; template: QualityTemplate }>(`${base}/reviews/${encodeURIComponent(id)}${reviewType ? `?reviewType=${reviewType}` : ''}`, signal);
}
export function meetingQualityChecks(meetingId: string, signal?: AbortSignal, offset = 0) {
  return read<{ reviews: MeetingQualityCheck[]; nextOffset?: number | null }>(`${base}/reviews?${new URLSearchParams({ meetingId, offset: String(offset) })}`, signal);
}
export function qualityReviews(filters: { start: string; end: string; coachEmail: string; status: string; timeZone: string; search: string; reviewType?: string; pdf?: string }, offset = 0, signal?: AbortSignal) {
  return read<ReviewList>(`${base}/reviews?${new URLSearchParams({ ...filters, offset: String(offset) })}`, signal);
}
export async function saveQualityReview(payload: { learnerId: string; expectedVersion: number; requestId: string; status: string; form: QualityForm; templateVersion?: number; reviewType?: QualityReviewType },
  id?: string, eventKey = '', reference?: string) {
  const params = new URLSearchParams({ eventKey });
  if (reference) params.set('reference', reference);
  const result = await request<{ review: QualityReview; document?: QualityReview['document'] }>(`${base}/reviews${id ? `/${encodeURIComponent(id)}` : `?${params}`}`,
    { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  reads.invalidate();
  return { ...result.review, ...(result.document ? { document: result.document } : {}) };
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
export function qualityPdf(review: QualityReview) { return attachedQualityPdf(review.id, review.version); }
export function attachedQualityPdf(reviewId: string, version: number) { return pdfs.read(`${base}/reviews/${encodeURIComponent(reviewId)}/documents/${version}`); }
