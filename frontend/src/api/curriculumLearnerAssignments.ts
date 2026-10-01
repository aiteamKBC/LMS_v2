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
  /** Learners the server skipped inside an otherwise successful request. */
  failedIds?: string[];
  failureMessage?: string;
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

export async function unassignCurriculumLearners(target: LearnerAssignmentTarget, learnerIds: string[]) {
  const result = await fetchCurriculumJson<LearnerAssignmentResult>(path(target), {
    method: 'DELETE', body: JSON.stringify({ learnerIds }), timeoutMs: 180_000,
    credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  clearCurriculumGetCache();
  learnerIds.forEach(id => invalidateWizardCacheById(id));
  invalidateLearnerDetailCache();
  return result;
}

/**
 * One request per learner takes far too many round trips, and one request for
 * the whole selection rewrites every learner's plan inside a single long
 * transaction -- which is what the 500/503 on a 15-learner save actually was.
 * This lands in between: small batches, each its own committed request.
 */
export const LEARNER_ASSIGNMENT_BATCH_SIZE = 5;
/** Two batches failing back to back means the endpoint is down, not this batch. */
const CONSECUTIVE_FAILURE_LIMIT = 2;

export interface LearnerAssignmentProgress {
  action: 'assign' | 'unassign';
  done: number;
  total: number;
}

export interface LearnerAssignmentApplyResult {
  /** Learner ids the server confirmed, split by direction. */
  added: string[];
  removed: string[];
  /** Learner ids whose batch failed. They are still selectable for a retry. */
  failed: string[];
  failureMessage: string | null;
  /** True when the run gave up early because the endpoint kept failing. */
  abandoned: boolean;
  changedCount: number;
  moduleCount: number;
}

function batches(ids: string[], size: number) {
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += size) out.push(ids.slice(index, index + size));
  return out;
}

export async function applyCurriculumLearnerAssignments(
  target: LearnerAssignmentTarget,
  change: { add: string[]; remove: string[] },
  onProgress?: (progress: LearnerAssignmentProgress) => void,
): Promise<LearnerAssignmentApplyResult> {
  const result: LearnerAssignmentApplyResult = {
    added: [], removed: [], failed: [], failureMessage: null, abandoned: false,
    changedCount: 0, moduleCount: 0,
  };
  let consecutiveFailures = 0;

  const run = async (action: 'assign' | 'unassign', ids: string[]) => {
    let done = 0;
    for (const batch of batches(ids, LEARNER_ASSIGNMENT_BATCH_SIZE)) {
      if (result.abandoned) {
        result.failed.push(...batch);
        continue;
      }
      try {
        const call = action === 'assign' ? assignCurriculumLearners : unassignCurriculumLearners;
        const outcome = await call(target, batch);
        // The endpoint saves learner by learner, so a 200 can still carry a
        // few it could not write. Those belong with the retries, not the wins.
        const skipped = new Set((outcome.failedIds || []).map(String));
        (action === 'assign' ? result.added : result.removed).push(...batch.filter(id => !skipped.has(id)));
        result.failed.push(...batch.filter(id => skipped.has(id)));
        if (skipped.size && outcome.failureMessage) result.failureMessage = outcome.failureMessage;
        result.changedCount += outcome.changedCount;
        result.moduleCount = outcome.moduleCount;
        consecutiveFailures = 0;
      } catch (reason) {
        result.failed.push(...batch);
        result.failureMessage = reason instanceof Error ? reason.message : 'Unable to save learner assignments.';
        consecutiveFailures += 1;
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) result.abandoned = true;
      }
      done += batch.length;
      onProgress?.({ action, done, total: ids.length });
    }
  };

  // Removals first: a learner moved out of the module frees the plan write that
  // an addition in the same save would otherwise contend with.
  if (change.remove.length) await run('unassign', change.remove);
  if (change.add.length) await run('assign', change.add);
  return result;
}
