import { coachFetch } from '@/lib/coachFetch';

export type LearnerScope = 'programme' | 'cohort' | 'group' | 'module';
export interface LearnerTarget { scope: LearnerScope; id: string; name: string }
export interface AssignedLearner { id: string; name: string; email: string; status: string; programme?: string; enrolmentId?: number | null }
export interface ActivityMetric { completed: number; total: number; percent: number | null }
export type AssignedLearnerProgress = { due: ActivityMetric | null; available: ActivityMetric; undatedActivities: number; asOfDate: string; timeZone: string } | { error: string };
export interface LearnerDirectoryPage {
  scope: LearnerScope; id: string; status: 'active' | 'all';
  total: number; filteredTotal: number; page: number; pageSize: number; learners: AssignedLearner[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

export interface LearnerStatusCounts { total: number; statuses: Record<string, number> }

export async function fetchLearnerStatusCounts(scope: LearnerScope, ids: string[], signal: AbortSignal): Promise<Record<string, LearnerStatusCounts | null>> {
  const query = new URLSearchParams({ scope, ids: ids.join(',') });
  const response = await coachFetch(`${API_BASE_URL}/curriculum/learner-directory/counts/?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load learner counts. Please retry.');
  const data = await response.json() as { counts?: Record<string, LearnerStatusCounts | null> };
  if (!data.counts || typeof data.counts !== 'object') throw new Error('Learner counts are unavailable. Please retry.');
  for (const id of ids) {
    const value = data.counts[id];
    if (value === null) continue;
    if (!value || !Number.isInteger(value.total) || value.total < 0 || !value.statuses || typeof value.statuses !== 'object'
      || Object.values(value.statuses).some(count => !Number.isInteger(count) || count < 0)
      || Object.values(value.statuses).reduce((sum, count) => sum + count, 0) !== value.total) {
      throw new Error('Learner counts are unavailable. Please retry.');
    }
  }
  return data.counts;
}

export async function fetchAssignedLearners(target: LearnerTarget, status: 'active' | 'all', q: string, page: number, signal: AbortSignal, lifecycleStatus?: string) {
  const query = new URLSearchParams({ scope: target.scope, id: target.id, status, q, page: String(page) });
  if (lifecycleStatus) query.set('lifecycle_status', lifecycleStatus);
  // One user-opened dialog owns this request. Keep its real abort signal and
  // bypass the shared curriculum cache, prefetch queue and automatic retries.
  const response = await coachFetch(`${API_BASE_URL}/curriculum/learner-directory/learners/?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) {
    const fallback = 'Could not load assigned learners. Please retry.';
    let data: { error?: unknown };
    try { data = await response.json() as { error?: unknown }; }
    catch { throw new Error(fallback); }
    throw new Error(typeof data.error === 'string' ? data.error : fallback);
  }
  return response.json() as Promise<LearnerDirectoryPage>;
}

async function directoryResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : fallback);
  return data;
}

export async function fetchAssignedLearnerProgress(target: LearnerTarget, learnerIds: string[], signal: AbortSignal): Promise<Record<string, AssignedLearnerProgress>> {
  const query = new URLSearchParams({ scope: target.scope, id: target.id, learnerIds: learnerIds.join(',') });
  const response = await coachFetch(`${API_BASE_URL}/curriculum/learner-directory/progress/?${query}`, { signal, cache: 'no-store' });
  const data = await directoryResponse(response, 'Could not load learner progress. Please retry.');
  const metric = (value: ActivityMetric) => value && Number.isInteger(value.completed) && Number.isInteger(value.total)
    && value.completed >= 0 && value.total >= value.completed
    && (value.total === 0 ? value.percent === null : typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100);
  if (!data?.learners || learnerIds.some(id => {
    const row = data.learners[id];
    return !row || (typeof row.error !== 'string' && (!metric(row.available) || (row.due !== null && !metric(row.due))
      || !Number.isInteger(row.undatedActivities) || row.undatedActivities < 0 || typeof row.asOfDate !== 'string' || row.timeZone !== 'Europe/London'));
  })) throw new Error('Learner progress is unavailable. Please retry.');
  return data.learners;
}

export async function changeProgrammeMembership(target: LearnerTarget, learner: AssignedLearner, action: 'remove' | 'restore'): Promise<void> {
  const response = await coachFetch(`${API_BASE_URL}/curriculum/learner-directory/membership/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: target.scope, id: target.id, learnerId: learner.id, expectedStatus: learner.status, expectedProgramme: learner.programme, action }),
  });
  const data = await directoryResponse(response, 'Could not update programme membership. Please retry.');
  if (data?.learnerId !== learner.id || data.status !== (action === 'remove' ? 'withdrawn' : 'active')) {
    throw new Error('The membership result could not be verified. Reload the list.');
  }
}
