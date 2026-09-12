import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';

export const LEARNER_TOTALS_REFRESH_MS = 30_000;

type Reader<T> = (kind: LearnerKind, id: string, signal?: AbortSignal, fresh?: boolean) => Promise<T>;
type Peek<T> = (kind: LearnerKind, id: string) => T | undefined;

/** Refresh visible totals without hiding the last successful response. */
export function useLiveLearnerRead<T>(
  kind: LearnerKind | null | undefined,
  id: string | null | undefined,
  enabled: boolean,
  read: Reader<T>,
  peek: Peek<T>,
) {
  const key = `${kind}:${id}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | undefined; error: string } | null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !kind || !id) return;
    let disposed = false;
    let sequence = 0;
    let pending = false;
    let controller: AbortController | undefined;
    let lastResume = -Infinity;
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;

    const load = (fresh = false, supersede = false) => {
      if (disposed || (pending && !supersede)) return;
      const requestSequence = ++sequence;
      controller?.abort();
      controller = new AbortController();
      pending = true;
      void read(kind, id, controller.signal, fresh).then(
        data => {
          if (!disposed && requestSequence === sequence) setState({ key, data, error: '' });
        },
        reason => {
          if (!disposed && requestSequence === sequence) setState(previous => ({
            key,
            data: previous?.key === key ? previous.data : peek(kind, id),
            error: reason instanceof Error ? reason.message : 'Could not refresh learner data. Please try again.',
          }));
        },
      ).finally(() => { if (requestSequence === sequence) pending = false; });
    };
    const onReturn = () => {
      if (!visible() || Date.now() - lastResume < 1_000) return;
      lastResume = Date.now();
      load(true);
    };
    const unsubscribe = subscribeLearnerReadInvalidation(() => {
      // A pre-save request may finish last. Replace its caller and ignore it.
      if (visible()) load(true, true);
    });
    const timer = window.setInterval(() => { if (visible()) load(true); }, LEARNER_TOTALS_REFRESH_MS);
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    load(revision > 0);

    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [key, kind, id, enabled, read, peek, revision]);

  const current = enabled && state?.key === key ? state : null;
  const data = enabled && kind && id
    ? current?.data !== undefined ? current.data : peek(kind, id)
    : undefined;
  return {
    data: data ?? null,
    error: current?.error || '',
    loading: enabled && !!kind && !!id && data === undefined && !current?.error,
    refresh,
  };
}
