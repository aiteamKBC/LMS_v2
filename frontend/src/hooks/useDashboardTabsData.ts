import type { LearnerKind } from '@/api/learnerDetail';
import { dashboardOverview } from '@/api/dashboardTabs';
import { useLiveLearnerRead } from './useLiveLearnerRead';
import type { DashboardPlanState } from '@/pages/workspace/learner/useDashboardPlan';
import { useCallback, useRef } from 'react';

export function useDashboardTabsData(kind: LearnerKind | null, id: string | undefined, enabled: boolean, opened: ReadonlySet<string>) {
  const lastRead = useRef('');
  const reader = useCallback((requestedKind: LearnerKind, requestedId: string, signal?: AbortSignal, fresh = false) => {
    const identity = `${requestedKind}:${requestedId}`;
    const changed = lastRead.current !== identity;
    lastRead.current = identity;
    // A refresh belongs to its learner. The shared hook's revision survives
    // learner switches; it must not bypass another learner's valid snapshot.
    return dashboardOverview.read(requestedKind, requestedId, signal, fresh && !changed);
  }, []);
  const read = useLiveLearnerRead(kind, id, enabled && opened.has('overview'), reader, dashboardOverview.peek);
  // Shared tab props retain their legacy plan interface. Real Overview renders
  // compact facts directly without a legacy schedule or learning merge.
  const plan: DashboardPlanState = {
    otjh: { actual: read.data?.metrics.otjh.actual ?? null, planned: read.data?.hours.planned ?? null,
      actualLoading: read.loading, plannedLoading: read.loading },
    data: null, plannedEndDate: read.data?.programmeEndDate ?? null, targetsLoading: read.loading,
    subjects: undefined, loading: read.loading, error: read.error, refresh: read.refresh, retryContract: read.refresh,
    week: { ...read, data: null }, schedule: { ...read, data: null },
  };
  return { overview: { plan, payload: read.data, loading: read.loading, error: read.error, refresh: read.refresh } };
}
export type DashboardTabSnapshots = ReturnType<typeof useDashboardTabsData>;
