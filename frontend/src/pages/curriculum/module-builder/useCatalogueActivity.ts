import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';
import { fetchModuleCatalogueActivity, type ModuleCatalogueActivities } from '@/api/moduleCatalogueActivity';
import { SYSTEM_TIME_ZONE } from '@/lib/format';

export function catalogueToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function useCatalogueActivity(refreshKey: string) {
  const [result, setResult] = useState<{ key: string; data: ModuleCatalogueActivities | null; error: string }>({ key: '', data: null, error: '' });
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(catalogueToday);
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    request.current?.abort();
    if (!refreshKey) { setResult({ key: '', data: {}, error: '' }); setLoading(false); return; }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    void fetchModuleCatalogueActivity(controller.signal).then(value => {
      if (!controller.signal.aborted) setResult({ key: refreshKey, data: value, error: '' });
    }).catch(() => {
      if (!controller.signal.aborted) setResult(previous => ({ key: refreshKey, data: previous.key === refreshKey ? previous.data : null, error: 'Module activity could not be verified. Try again or view all modules.' }));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [refreshKey]);
  useEffect(() => { reload(); return () => request.current?.abort(); }, [refreshKey, reload]);
  useLiveRefresh(reload);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(catalogueToday()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return { data: result.key === refreshKey ? result.data : null, loading: loading || result.key !== refreshKey,
    error: result.key === refreshKey ? result.error : '', today, reload };
}

export function catalogueModuleActive(activity: ModuleCatalogueActivities[string] | undefined, today: string) {
  return Boolean(activity?.startDate && activity.lastLiveDate
    && activity.startDate <= today && today <= activity.lastLiveDate);
}
