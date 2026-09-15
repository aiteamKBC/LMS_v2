import { clearCurriculumGetCache, fetchCurriculumJson } from '@/lib/curriculumApi';
import { invalidateLearnerDetailCache } from './learnerDetail';
import { invalidateWizardCacheById } from './extendedIlr';

export interface LearnerAssignmentTarget {
  scope: 'cohort' | 'module';
  id: string;
  name: string;
}

export interface AssignmentLearner {
  id: string;
  name: string;
  email: string;
  programme: string;
  company: string;
  cohort: string;
  group: string;
  programmeStatus: string;
  learnerType: string;
  assigned: boolean;
  moduleCount: number;
}

export interface LearnerAssignmentDirectory {
  target: LearnerAssignmentTarget & { moduleCount: number; programmeName: string };
  learners: AssignmentLearner[];
  totals: { learnerCount: number; assignedCount: number };
}

export interface LearnerAssignmentResult {
  assignedCount: number;
  changedCount: number;
  moduleCount: number;
}

function path(target: LearnerAssignmentTarget) {
  return `/curriculum/${target.scope === 'cohort' ? 'cohorts' : 'modules'}/${encodeURIComponent(target.id)}/learner-assignments/`;
}

export function fetchLearnerAssignments(target: LearnerAssignmentTarget, signal?: AbortSignal) {
  return fetchCurriculumJson<LearnerAssignmentDirectory>(path(target), {
    signal, revalidate: true, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
}

export async function assignCurriculumLearners(target: LearnerAssignmentTarget, learnerIds: string[]) {
  const result = await fetchCurriculumJson<LearnerAssignmentResult>(path(target), {
    method: 'POST', body: JSON.stringify({ learnerIds }), timeoutMs: 180_000,
    credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  clearCurriculumGetCache();
  learnerIds.forEach(id => invalidateWizardCacheById(id));
  invalidateLearnerDetailCache();
  return result;
}
