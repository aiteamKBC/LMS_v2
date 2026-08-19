import { useCallback, useEffect, useState } from 'react';

/**
 * Fetch-once hook with the three states every console page needs.
 *
 * Lives apart from `AdminPage.tsx` so that file exports only components and
 * keeps fast refresh working.
 *
 * `reload` is returned so pages with actions (suspend an account, say) can
 * refresh without duplicating the effect; `setData` lets a page patch one row
 * in place after a successful write rather than refetching the whole page.
 */
export function useAdminData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // The loader closure is rebuilt on every render at the call site; `deps` are
  // the caller's real inputs, so exhaustive-deps is not the authority here.
  // `tick` is what makes `reload` refetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then(result => { if (!cancelled) { setData(result); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err?.message || 'Could not load data.'); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, loading, error, reload, setData };
}
