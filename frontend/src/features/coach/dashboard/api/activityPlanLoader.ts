import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { withCoachViewAs } from '@/lib/coachViewAs';
import type { ActivityPlanProgress } from '@/pages/coach/caseload/types';

type Job = {
  learnerId: string; url: string; signal: AbortSignal;
  resolve: (plan: ActivityPlanProgress) => void; reject: (error: unknown) => void;
  cancel: () => void;
};
type Result = { learnerId: string; activityPlan?: ActivityPlanProgress; error?: string };
const queued: Job[] = [];
let active = false;
let scheduled = false;
const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
const inconsistent = () => new Error('Activity plan response is inconsistent. Please retry.');

function validate(plan: ActivityPlanProgress | undefined): ActivityPlanProgress {
  if (!plan || !Number.isInteger(plan.completed) || !Number.isInteger(plan.total)
    || plan.completed < 0 || plan.total < plan.completed
    || (plan.total === 0 ? plan.percent !== null : !Number.isFinite(plan.percent)
      || Math.abs(Number(plan.percent) - plan.completed / plan.total * 100) > .011)) throw inconsistent();
  return plan;
}

async function pump() {
  if (active) return;
  // Coalesce visible rows. Keep the slot until the real shared GET settles,
  // even when all its callers unmount; the API also bounds its DB workers.
  for (let i = queued.length - 1; i >= 0; i -= 1) {
    if (queued[i].signal.aborted) queued.splice(i, 1);
  }
  if (!queued.length) return;
  const first = queued.shift()!;
  const batch = [first];
  for (let i = 0; i < queued.length && batch.length < 4;) {
    if (queued[i].url === first.url) batch.push(...queued.splice(i, 1));
    else i += 1;
  }
  const ids = [...new Set(batch.map(job => job.learnerId))].sort();
  const url = `${first.url}${first.url.includes('?') ? '&' : '?'}learnerIds=${ids.map(encodeURIComponent).join(',')}`;
  active = true;
  try {
    const wire = await fetchSharedJsonGet<{ results: Result[] }>(url, { credentials: 'include' });
    if (!Array.isArray(wire?.results) || wire.results.length !== ids.length
      || new Set(wire.results.map(row => row?.learnerId)).size !== ids.length
      || wire.results.some(row => !row || !ids.includes(row.learnerId))) throw inconsistent();
    for (const job of batch) {
      if (job.signal.aborted) continue;
      const row = wire.results.find(item => item.learnerId === job.learnerId)!;
      try {
        if (row.error) throw new Error('Activity plan unavailable. Please retry.');
        job.resolve(validate(row.activityPlan));
      } catch (error) { job.reject(error); }
    }
  } catch (error) {
    batch.forEach(job => { if (!job.signal.aborted) job.reject(error); });
  } finally {
    batch.forEach(job => job.signal.removeEventListener('abort', job.cancel));
    active = false;
    void pump();
  }
}

export function loadActivityPlan(learnerId: string, signal: AbortSignal): Promise<ActivityPlanProgress> {
  // Capture view-as at enqueue time. Never combine different coach workspaces.
  const url = withCoachViewAs('/coach_api/coach/dashboard/activity-plans');
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted()); };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    queued.push({ learnerId, url, signal, resolve, reject, cancel });
    if (!active && !scheduled) {
      scheduled = true;
      setTimeout(() => { scheduled = false; void pump(); }, 0);
    }
  });
}
