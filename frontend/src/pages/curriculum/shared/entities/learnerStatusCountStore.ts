import { fetchLearnerStatusCounts, type LearnerScope, type LearnerStatusCounts, type LearnerTarget } from '@/api/assignedLearners';

export type StatusCountState = { value: LearnerStatusCounts | null; loading: boolean; error: string };
const keyFor = (target: LearnerTarget) => `${target.scope}:${target.id}`;

/** Page-local numbers only. Mounting rows is batched; names load on explicit open. */
export function createLearnerStatusCountStore() {
  const values = new Map<string, StatusCountState>();
  const listeners = new Map<string, Set<(state: StatusCountState) => void>>();
  const targets = new Map<string, LearnerTarget>();
  const versions = new Map<string, number>();
  const revisions = new Map<string, unknown>();
  const pending = new Set<string>();
  const controllers = new Set<AbortController>();
  let queued = false;
  const publish = (key: string, state: StatusCountState) => {
    values.set(key, state);
    listeners.get(key)?.forEach(listener => listener(state));
  };
  const flush = async () => {
    queued = false;
    const keys = [...pending].filter(key => listeners.has(key)); pending.clear();
    for (const scope of ['programme', 'cohort', 'group', 'module'] as LearnerScope[]) {
      const scoped = keys.filter(key => targets.get(key)?.scope === scope);
      for (let index = 0; index < scoped.length; index += 100) {
        const batch = scoped.slice(index, index + 100).map(key => ({ key, version: versions.get(key), id: targets.get(key)!.id }));
        const controller = new AbortController(); controllers.add(controller);
        try {
          const result = await fetchLearnerStatusCounts(scope, batch.map(item => item.id), controller.signal);
          if (!controller.signal.aborted) batch.forEach(({ key, version, id }) => {
            if (versions.get(key) === version) publish(key, { value: result[id], loading: false, error: result[id] ? '' : 'This record is unavailable.' });
          });
        } catch (reason) {
          if (!controller.signal.aborted) batch.forEach(({ key, version }) => {
            if (versions.get(key) === version) publish(key, { value: values.get(key)?.value || null, loading: false,
              error: reason instanceof Error ? reason.message : 'Could not load learner counts.' });
          });
        } finally { controllers.delete(controller); }
      }
    }
  };
  const enqueue = (key: string) => {
    versions.set(key, (versions.get(key) || 0) + 1);
    publish(key, { value: values.get(key)?.value || null, loading: true, error: '' });
    pending.add(key);
    if (!queued) { queued = true; queueMicrotask(() => { void flush(); }); }
  };
  return {
    subscribe(target: LearnerTarget, listener: (state: StatusCountState) => void) {
      const key = keyFor(target), set = listeners.get(key) || new Set(); set.add(listener); listeners.set(key, set); targets.set(key, target);
      if (values.has(key)) listener(values.get(key)!); else enqueue(key);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
    refresh(target: LearnerTarget, revision?: unknown) {
      const key = keyFor(target);
      if (revision !== undefined) {
        if (revisions.has(key) && revisions.get(key) === revision) return;
        revisions.set(key, revision);
      }
      enqueue(key);
    },
    refreshAll() { listeners.forEach((_set, key) => enqueue(key)); },
    dispose() { controllers.forEach(controller => controller.abort()); controllers.clear(); listeners.clear(); pending.clear(); values.clear(); targets.clear(); versions.clear(); revisions.clear(); },
  };
}
