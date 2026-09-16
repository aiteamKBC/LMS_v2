import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshOnReturn } from './useRefreshOnReturn';

/** Refresh saved database results; never enqueue a Teams import from a read. */
export function useSavedSessionData<T>(load: (signal: AbortSignal) => Promise<T>, active = true) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let disposed = false;
    let pending: AbortController | undefined;
    setData(undefined); setLoading(true); setError('');
    const read = () => {
      if (disposed || pending) return;
      const controller = new AbortController();
      pending = controller;
      void load(controller.signal).then(value => {
        if (!disposed) { setData(value); setError(''); }
      }).catch(reason => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Could not load saved results.');
      }).finally(() => {
        if (!disposed) { pending = undefined; setLoading(false); }
      });
    };
    refreshRef.current = read;
    read();
    return () => { disposed = true; pending?.abort(); refreshRef.current = () => {}; };
  }, [load]);
  useRefreshOnReturn(refresh, { enabled: active });
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);
  return { data, loading, error, refresh };
}
