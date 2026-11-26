import { useEffect, useState } from 'react';
import { fetchEmployerLearningOverview, type EmployerLearnerCard } from '@/api/employerPortal';
import type { DashboardOverviewPayload } from '@/api/dashboardTabs';
import { learnerKey, type Loadable } from './employerDashboardData';

export type EmployerLearningRecords = Record<string, Loadable<DashboardOverviewPayload>>;

export function useEmployerLearningSummary(employerId: string, learners: EmployerLearnerCard[], enabled: boolean) {
  const [records, setRecords] = useState<EmployerLearningRecords>({});
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setRecords({});
    if (!enabled) return () => controller.abort();
    const queue = [...learners];
    async function worker() {
      while (queue.length && !signal.aborted) {
        const learner = queue.shift()!;
        const key = learnerKey(learner);
        try {
          const data = await fetchEmployerLearningOverview(employerId, learner.kind, learner.id, signal, true);
          if (!signal.aborted) setRecords(current => ({ ...current, [key]: { status: 'ready', data } }));
        } catch {
          if (!signal.aborted) setRecords(current => ({ ...current, [key]: { status: 'error' } }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, learners.length) }, () => worker()));
    return () => controller.abort();
  }, [employerId, learners, enabled, refresh]);
  return { records, retry: () => setRefresh(value => value + 1) };
}
