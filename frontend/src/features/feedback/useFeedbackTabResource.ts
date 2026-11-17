import { useCallback, useEffect, useRef, useState } from 'react';

/** Page-owned data: an inactive tab can finish loading without blocking another. */
export function useFeedbackTabResource<T>(load: () => Promise<T>, enabled: boolean, revision: number) {
  const [retry, setRetry] = useState(0);
  const key = `${revision}:${retry}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();
  const requested = useRef('');
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!enabled || requested.current === key) return;
    requested.current = key;
    load().then(data => {
      if (mounted.current && requested.current === key) setResult({ key, data });
    }).catch(reason => {
      if (mounted.current && requested.current === key) setResult({ key, error: reason instanceof Error ? reason.message : 'Could not load feedback.' });
    });
  }, [load, enabled, key]);
  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: enabled && result?.key !== key,
    reload: useCallback(() => setRetry(value => value + 1), []),
  };
}
