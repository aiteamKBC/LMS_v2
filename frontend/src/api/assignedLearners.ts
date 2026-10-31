import { coachFetch } from '@/lib/coachFetch';

export type LearnerScope = 'programme' | 'cohort' | 'group' | 'module';
export interface LearnerTarget { scope: LearnerScope; id: string; name: string }
export interface AssignedLearner { id: string; name: string; email: string; status: string }
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
