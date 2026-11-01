import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshOnRemoteWrite, useRefreshOnReturn } from '@/hooks/useRefreshOnReturn';
import { fetchModuleCatalogueActivity, type ModuleCatalogueActivities } from '@/api/moduleCatalogueActivity';
import { createCachedResource } from '@/api/cachedRequest';
import { SYSTEM_TIME_ZONE } from '@/lib/format';

// The shared resource cache is memory-only and cleared on sign-out/account
// changes. A short TTL covers remounts and focus bursts without hiding edits.
const activityReads = createCachedResource<ModuleCatalogueActivities>(
  'module-catalogue-activity', () => fetchModuleCatalogueActivity(AbortSignal.timeout(15_000)), 30_000, 2,
);

export function catalogueToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function useCatalogueActivity(refreshKey: string, accountScope = '') {
  const key = refreshKey ? JSON.stringify([accountScope, refreshKey]) : '';
  const [result, setResult] = useState<{ key: string; data: ModuleCatalogueActivities | null; error: string }>({ key: '', data: null, error: '' });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(catalogueToday);
  const request = useRef<AbortController | null>(null);
  const load = useCallback((revalidate: boolean) => {
    request.current?.abort();
    if (!key) { setResult({ key: '', data: {}, error: '' }); setLoading(false); return; }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    // Each consumer cancels its interest, not the shared transport. StrictMode
    // and a second reader can safely join the same bounded network request.
    void activityReads.read(key, { revalidate }).then(value => {
      if (!controller.signal.aborted) setResult({ key, data: value, error: '' });
    }).catch(() => {
      if (!controller.signal.aborted) setResult(previous => ({ key, data: previous.key === key ? previous.data : null, error: 'Module activity could not be verified. Try again or view all modules.' }));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [key]);
  const reload = useCallback(() => load(true), [load]);
  useEffect(() => { load(false); return () => request.current?.abort(); }, [load]);
  useRefreshOnReturn(() => load(false), { enabled: Boolean(key) });
  useRefreshOnRemoteWrite(reload, { enabled: Boolean(key) });
  useEffect(() => {
    const timer = window.setInterval(() => setToday(catalogueToday()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const data = result.key === key ? result.data : activityReads.peek(key) ?? null;
  return { data, loading: loading || result.key !== key,
    error: result.key === key ? result.error : '', today, reload };
}

export function catalogueModuleActive(activity: ModuleCatalogueActivities[string] | undefined, today: string) {
  return Boolean(activity?.startDate && activity.lastLiveDate
    && activity.startDate <= today && today <= activity.lastLiveDate);
}
