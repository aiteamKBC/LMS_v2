import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { PlanSubjectSummary } from '@/api/learnerOverview';
import type { LogSummary } from '@/features/monthly-logs/api';
import { useCaseFileSession } from './CaseFileSession';

type MonthFocus = Pick<TrainingPlanDashboard, 'months' | 'actual' | 'actualAvailable' | 'reviews'> & {
  schedule?: TrainingPlanDashboard; week?: { planSubjects: PlanSubjectSummary[] }; hours?: LogSummary;
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
