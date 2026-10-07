import { useCallback, useEffect, useRef, useState } from 'react';
import { useCaseFileSession } from './CaseFileSession';

export type MonthFocus = {
  month: string;
  summary: { requiredHours: number | null; achievedHours: number | null; differenceHours: number | null; ksbCount: number | null };
  reviews: { id: string; type: string; title: string; date: string; time: string | null; durationMinutes: number | null; status: string }[];
  assignments: { id: string; title: string; date: string; status: string }[];
  lectures: { id: string; date: string; time: string; title: string; tutor: string; durationMinutes: number }[];
};

export function useCaseFileMonthFocus(month: string, enabled: boolean) {
  const session = useCaseFileSession();
  const [revision, setRevision] = useState(0);
  const handledRevision = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const [state, setState] = useState<{ month: string; data?: MonthFocus; error?: string }>();
  useEffect(() => {
    if (!session || !enabled) return;
    const controller = new AbortController();
    const fresh = handledRevision.current !== revision;
    handledRevision.current = revision;
    setState({ month });
    void session.read<MonthFocus>('monthly-focus', { month }, { signal: controller.signal, refresh: fresh }).then(data => {
      if (!controller.signal.aborted) setState({ month, data });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setState({ month, error: reason instanceof Error ? reason.message : 'Could not load monthly focus.' });
    });
    return () => controller.abort();
  }, [session, month, enabled, revision]);
  return session && enabled ? { ...(state?.month === month ? state : { month }), refresh } : undefined;
}
