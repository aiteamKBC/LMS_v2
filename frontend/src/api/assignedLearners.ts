import { coachFetch } from '@/lib/coachFetch';

export type LearnerScope = 'programme' | 'cohort' | 'group' | 'module';
export interface LearnerTarget { scope: LearnerScope; id: string; name: string }
export interface AssignedLearner { id: string; name: string; email: string; status: string }
export interface LearnerDirectoryPage {
  scope: LearnerScope; id: string; status: 'active' | 'all';
  total: number; filteredTotal: number; page: number; pageSize: number; learners: AssignedLearner[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

export async function fetchAssignedLearners(target: LearnerTarget, status: 'active' | 'all', q: string, page: number, signal: AbortSignal) {
  const query = new URLSearchParams({ scope: target.scope, id: target.id, status, q, page: String(page) });
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
