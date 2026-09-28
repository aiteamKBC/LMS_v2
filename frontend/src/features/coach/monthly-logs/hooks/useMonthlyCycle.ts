import { useEffect, useState } from 'react';
import type { MonthlyActivityResponse } from '@/pages/coach/monthly-cycle/types';
import { getCoachMonthlyCycle } from '../api/monthlyLogsApi';

const MONTHLY_ACTIVITY_TIMEOUT_MS = 20000;

export function useMonthlyCycle(month: string, enabled: boolean) {
  const [data, setData] = useState<MonthlyActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    setLoading(true);
    setError('');
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, MONTHLY_ACTIVITY_TIMEOUT_MS);
    getCoachMonthlyCycle(month, controller.signal)
      .then(payload => { if (!disposed) setData(payload); })
      .catch((reason: unknown) => {
        if (disposed || (reason instanceof DOMException && reason.name === 'AbortError' && !timedOut)) return;
        setData(null);
        setError(timedOut
          ? 'Monthly activity is taking too long to load. Please refresh or try a different month.'
          : reason instanceof Error ? reason.message : 'Unable to load monthly activity.');
      })
      .finally(() => { window.clearTimeout(timeoutId); if (!disposed) setLoading(false); });
    return () => { disposed = true; window.clearTimeout(timeoutId); controller.abort(); };
  }, [enabled, month]);

  return { data, loading, error };
}
