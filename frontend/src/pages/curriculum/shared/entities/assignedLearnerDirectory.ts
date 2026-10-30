import { createContext, useContext } from 'react';
import { fetchAssignedCounts, type LearnerScope, type LearnerTarget } from '@/api/assignedLearners';

export type CountState = { count: number | null; failed?: boolean };
export const keyFor = (target: LearnerTarget) => `${target.scope}:${target.id}`;

export function createCountStore() {
  const values = new Map<string, CountState>(), listeners = new Map<string, Set<(state: CountState) => void>>();
  const pending = new Map<string, LearnerTarget>(), controllers = new Set<AbortController>();
  const forced = new Set<string>();
  let queued = false, closed = false;
  const publish = (key: string, value: CountState) => {
    values.set(key, value); listeners.get(key)?.forEach(listener => listener(value));
  };
  const flush = async () => {
    queued = false;
    const targets = [...pending.values()]; pending.clear();
    for (const scope of ['programme', 'cohort', 'group', 'module'] as LearnerScope[]) {
      const ids = targets.filter(target => target.scope === scope).map(target => target.id);
      for (let index = 0; index < ids.length && !closed; index += 30) {
        const batch = ids.slice(index, index + 30), controller = new AbortController(); controllers.add(controller);
        try {
          const refresh = batch.some(id => forced.has(`${scope}:${id}`));
          batch.forEach(id => forced.delete(`${scope}:${id}`));
          const result = await fetchAssignedCounts(scope, batch, controller.signal, refresh);
          if (!closed && !controller.signal.aborted) batch.forEach(id => publish(`${scope}:${id}`, { count: result.counts[id] ?? null, failed: result.counts[id] == null }));
        } catch {
          if (!closed && !controller.signal.aborted) batch.forEach(id => publish(`${scope}:${id}`, { count: null, failed: true }));
        } finally { controllers.delete(controller); }
      }
    }
  };
  return {
    subscribe(target: LearnerTarget, listener: (state: CountState) => void) {
      closed = false;
      const key = keyFor(target), set = listeners.get(key) || new Set(); set.add(listener); listeners.set(key, set);
      const existing = values.get(key);
      if (existing) listener(existing);
      else { pending.set(key, target); if (!queued) { queued = true; queueMicrotask(() => { void flush(); }); } }
      return () => { set.delete(listener); };
    },
    update(target: LearnerTarget, count: number) { publish(keyFor(target), { count }); },
    refresh(target: LearnerTarget) {
      const key = keyFor(target); values.delete(key); pending.set(key, target); forced.add(key);
      if (!queued) { queued = true; queueMicrotask(() => { void flush(); }); }
    },
    dispose() { closed = true; controllers.forEach(controller => controller.abort()); },
  };
}

interface DirectoryContext {
  store: ReturnType<typeof createCountStore>;
  open: (target: LearnerTarget, manage?: () => void | Promise<unknown>) => void;
}
export const Context = createContext<DirectoryContext | null>(null);
export function useRefreshAssignedLearners() { return useContext(Context)?.store.refresh; }
