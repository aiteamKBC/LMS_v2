import type { LearnerKind } from './learnerDetail';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

export type CanonicalModuleProgress = {
  id: string; title: string; completed: number; total: number; percent: number | null;
};
export type ModuleProgressResponse = { modules: CanonicalModuleProgress[] };
const url = (kind: LearnerKind, id: string) => `/learner_api/module-progress/${kind}/${id}/`;
const headers = { Accept: 'application/json' };

export async function fetchModuleProgress(kind: LearnerKind, id: string, signal?: AbortSignal, force = false) {
  const result = await readLearnerJson<ModuleProgressResponse>(url(kind, id), { signal, force, headers, ttlMs: 30_000 });
  if (!Array.isArray(result.modules) || result.modules.some(row => typeof row.id !== 'string'
    || typeof row.title !== 'string' || typeof row.completed !== 'number' || typeof row.total !== 'number'
    || !(row.percent === null || (typeof row.percent === 'number' && Number.isFinite(row.percent))))) {
    throw new Error('Received an invalid module progress response.');
  }
  return result;
}

export function peekModuleProgress(kind: LearnerKind, id: string) {
  return peekLearnerJson<ModuleProgressResponse>(url(kind, id), { headers });
}
