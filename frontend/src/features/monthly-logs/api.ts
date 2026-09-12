import { readLearnerJson, invalidateLearnerReads } from '@/api/learnerRead';
import { coachViewAs } from '@/lib/coachViewAs';
import type { ActivityContent, JournalSummary, MonthDetail, MonthState, SignatureCaptureMethod } from '@/features/old-otjh/api';

export type LogMonth = MonthState & { source: 'legacy' | 'lms' };
export type LogDetail = MonthDetail & { source: 'legacy' | 'lms' };
export type LogSummary = JournalSummary & {
  months: LogMonth[]; total_months: number; completed_months: number; read_only: boolean; csrf_token: string;
};
export type LogLearner = { id: number; name: string; programme: string };
export type LogPerspective = 'learner' | 'coach';

function url(path: string, perspective: LogPerspective) {
  const params = new URLSearchParams();
  params.set('perspective', perspective);
  const selected = perspective === 'coach' ? coachViewAs() : null;
  if (selected) params.set('viewAsCoach', selected.email);
  return `/learner_api/monthly-logs/${path}${params.size ? `?${params}` : ''}`;
}
const read = <T,>(path: string, signal?: AbortSignal, perspective: LogPerspective = 'coach') => readLearnerJson<T>(url(path, perspective), { signal, ttlMs: 0 });
export const getLogSummary = (id: string, signal?: AbortSignal, perspective: LogPerspective = 'coach') => read<LogSummary>(`${id}/`, signal, perspective);
export const getLogMonth = (id: string, month: string, signal?: AbortSignal, perspective: LogPerspective = 'coach') => read<LogDetail>(`${id}/${month}/`, signal, perspective);
export async function getLogContent(id: string, month: string, rowId: number, perspective: LogPerspective = 'coach') {
  const content = await read<ActivityContent>(`${id}/${month}/activities/${rowId}/`, undefined, perspective);
  return { ...content, parts: content.parts.map(part => ({ ...part,
    url: part.url?.startsWith('/') && !part.url.startsWith('//') ? new URL(part.url, window.location.origin).href : part.url,
  })) };
}
export const getLogLearners = () => read<{ learners: LogLearner[] }>('learners/');

export async function signLogMonth(id: string, month: string, digest: string, blob: Blob, capture: SignatureCaptureMethod, csrfToken: string, perspective: LogPerspective = 'coach') {
  const form = new FormData();
  form.set('signature', blob, 'signature.png');
  form.set('snapshot_digest', digest);
  form.set('confirmed', 'true');
  form.set('capture_method', capture);
  const response = await fetch(url(`${id}/${month}/sign/`, perspective), { method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': csrfToken }, body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Could not save your signature. Please try again.');
  invalidateLearnerReads();
  return data as LogDetail;
}
