import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchDashboardMonthly, invalidateDashboardMonthly, peekDashboardMonthly, type DashboardMonthlyPlan, type MonthlyDisplayBounds } from '@/api/dashboardMonthly';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';

/** Each selection owns its response; an older month or pre-save read cannot replace it. */
export function useDashboardMonthly(kind: LearnerKind, id: string, month: string, subject = '', enabled = true, bounds?: MonthlyDisplayBounds) {
  const start = bounds ? bounds.programmeStartDate ?? '' : null;
  const end = bounds ? bounds.programmeEndDate ?? '' : null;
  const identity = JSON.stringify([kind, id, month, subject, start, end]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ identity: string; data: DashboardMonthlyPlan | null; error: string; refreshing: boolean } | null>(null);
  const refresh = useCallback(() => { invalidateDashboardMonthly(kind, id); setRevision(previous => previous + 1); }, [kind, id]);
  useEffect(() => subscribeLearnerReadInvalidation(() => setRevision(previous => previous + 1)), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const bounds = start === null && end === null ? undefined : { programmeStartDate: start, programmeEndDate: end };
    const cached = peekDashboardMonthly(kind, id, month, subject, bounds);
    setState(previous => ({ identity, data: cached ?? (previous?.identity === identity ? previous.data : null), error: '', refreshing: true }));
    void fetchDashboardMonthly(kind, id, month, controller.signal, subject, bounds).then(data => {
      if (!controller.signal.aborted) setState({ identity, data, error: '', refreshing: false });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setState(previous => ({ identity,
        data: previous?.identity === identity ? previous.data : null,
        error: reason instanceof Error ? reason.message : 'Could not load your monthly dashboard. Please try again.', refreshing: false }));
    });
    return () => controller.abort();
  }, [identity, kind, id, month, subject, revision, enabled, start, end]);
  const current = enabled && state?.identity === identity ? state : null;
  const data = enabled ? current?.data ?? peekDashboardMonthly(kind, id, month, subject, bounds) ?? null : null;
  return { data, error: current?.error || '', loading: enabled && !data && !current?.error,
    refreshing: enabled && (current?.refreshing ?? !data), refresh };
}
