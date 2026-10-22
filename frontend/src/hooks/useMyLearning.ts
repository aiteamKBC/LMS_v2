import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { myLearningCatalogue, myLearningModule, searchMyLearning } from '@/api/myLearning';
import { useLiveLearnerRead } from './useLiveLearnerRead';

export function useMyLearningCatalogue(kind?: LearnerKind, id?: string, enabled = true) {
  return useLiveLearnerRead(kind, id, enabled, myLearningCatalogue.read, myLearningCatalogue.peek);
}

/** Include the selected subject in both hook state and transport cache identity. */
export function useMyLearningModule(kind?: LearnerKind, id?: string, subject?: string | null) {
  const key = id && subject ? JSON.stringify([id, subject]) : undefined;
  const read = useCallback(async (readKind: LearnerKind, identity: string, signal?: AbortSignal, fresh = false) => {
    const [learner, selected] = JSON.parse(identity) as [string, string];
    return myLearningModule.read(readKind, learner, selected, signal, fresh);
  }, []);
  const peek = useCallback((readKind: LearnerKind, identity: string) => {
    const [learner, selected] = JSON.parse(identity) as [string, string];
    return myLearningModule.peek(readKind, learner, selected);
  }, []);
  return useLiveLearnerRead(kind, key, !!key, read, peek);
}

/** Debounce activity search, abort superseded requests and hide stale identities. */
export function useMyLearningSearch(kind: LearnerKind | undefined, id: string | undefined, query: string, enabled: boolean) {
  const term = query.trim();
  const key = JSON.stringify([kind,id,term]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; ids: string[]; error: string; loading: boolean }>({ key: '', ids: [], error: '', loading: false });
  useEffect(() => {
    if (!enabled || !kind || !id || !term) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ key, ids: [], error: '', loading: true });
      void searchMyLearning(kind, id, term, controller.signal).then(ids => {
        if (!controller.signal.aborted) setState({ key, ids, error: '', loading: false });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ key, ids: [], error: String(error.message), loading: false });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind,id,term,key,enabled,attempt]);
  return { ...(state.key === key ? state : { ids: [], error: '', loading: !!term && enabled }), retry: () => setAttempt(value => value+1) };
}

