import { createContext, useContext } from 'react';
import type { LearnerTarget } from '@/api/assignedLearners';
import type { createLearnerStatusCountStore } from './learnerStatusCountStore';

export type CountState = { count: number | null };
export const keyFor = (target: LearnerTarget) => `${target.scope}:${target.id}`;

export function createCountStore() {
  // Only mounted badges subscribe. No requests, retained roster data or timers.
  const listeners = new Map<string, Set<(state: CountState) => void>>();
  const publish = (key: string, value: CountState) => {
    listeners.get(key)?.forEach(listener => listener(value));
  };
  return {
    subscribe(target: LearnerTarget, listener: (state: CountState) => void) {
      const key = keyFor(target), set = listeners.get(key) || new Set(); set.add(listener); listeners.set(key, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
    update(target: LearnerTarget, count: number) { publish(keyFor(target), { count }); },
    refresh(target: LearnerTarget) {
      publish(keyFor(target), { count: null });
    },
    dispose() { listeners.clear(); },
  };
}

interface DirectoryContext {
  store: ReturnType<typeof createCountStore>;
  statusStore: ReturnType<typeof createLearnerStatusCountStore>;
  open: (target: LearnerTarget, manage?: () => void | Promise<unknown>, status?: string) => void;
}
export const Context = createContext<DirectoryContext | null>(null);
export function useRefreshAssignedLearners() { return useContext(Context)?.store.refresh; }
