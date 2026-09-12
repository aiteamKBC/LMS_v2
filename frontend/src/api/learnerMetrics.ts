import { readLearnerJson, peekLearnerJson } from './learnerRead';
import type { LearnerKind } from './learnerDetail';

export interface ProgressMetric {
  completed: number | null;
  total: number | null;
  percent: number | null;
  status: 'ready' | 'empty' | 'unavailable';
  reason?: string;
  codes?: { code: string; completed: number; total: number; percent: number | null }[];
}
export interface LearnerMetrics {
  migrated: boolean;
  programme: ProgressMetric;
  ksb: ProgressMetric;
  otjh: { historical: number | null; new: number; actual: number | null; planned: number | null };
}
const url = (kind: LearnerKind, id: string) => `/learner_api/metrics/${kind}/${id}/`;
function valid(data: LearnerMetrics | undefined): data is LearnerMetrics {
  return !!(data?.programme?.status && data?.ksb?.status && data?.otjh);
}
export const peekLearnerMetrics = (kind: LearnerKind, id: string) => {
  const data = peekLearnerJson<LearnerMetrics>(url(kind, id));
  return valid(data) ? data : undefined;
};
export async function fetchLearnerMetrics(kind: LearnerKind, id: string, signal?: AbortSignal, force = false) {
  const data = await readLearnerJson<LearnerMetrics>(url(kind, id), { signal, revalidate: force, ttlMs: 30_000 });
  if (!valid(data)) {
    throw new Error('The server returned invalid programme totals. Please try again.');
  }
  return data;
}
