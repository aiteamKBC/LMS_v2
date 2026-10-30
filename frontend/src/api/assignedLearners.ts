import { fetchCurriculumJson } from '@/lib/curriculumApi';

export type LearnerScope = 'programme' | 'cohort' | 'group' | 'module';
export interface LearnerTarget { scope: LearnerScope; id: string; name: string }
export interface AssignedLearner { id: string; name: string; email: string; status: string }
export interface LearnerDirectoryPage {
  scope: LearnerScope; id: string; status: 'active' | 'all';
  total: number; filteredTotal: number; page: number; pageSize: number; learners: AssignedLearner[];
}

export function fetchAssignedCounts(scope: LearnerScope, ids: string[], signal: AbortSignal, refresh = false) {
  const query = new URLSearchParams({ scope, ids: ids.join(',') });
  if (refresh) query.set('refresh', '1');
  return fetchCurriculumJson<{ counts: Record<string, number | null> }>(`/curriculum/learner-directory/counts/?${query}`, { signal, revalidate: true });
}

export function fetchAssignedLearners(target: LearnerTarget, status: 'active' | 'all', q: string, page: number, signal: AbortSignal) {
  const query = new URLSearchParams({ scope: target.scope, id: target.id, status, q, page: String(page) });
  if (!q && page === 1) query.set('refresh', '1');
  return fetchCurriculumJson<LearnerDirectoryPage>(`/curriculum/learner-directory/learners/?${query}`, { signal, revalidate: true });
}
