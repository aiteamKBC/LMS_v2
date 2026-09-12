import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { overviewSchedule, overviewWeek } from '@/api/learnerOverview';
import { fetchTrainingPlanContract, type TrainingPlanContract } from '@/api/trainingPlanDashboard';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';

export function useDashboardPlan(kind: LearnerKind, id: string) {
  // These reads are shared with This week / Upcoming, including refreshes.
  const week = useLiveLearnerRead(kind, id, true, overviewWeek.read, overviewWeek.peek);
  const schedule = useLiveLearnerRead(kind, id, true, overviewSchedule.read, overviewSchedule.peek);
  const identity = `${kind}:${id}`;
  const [attempt, setAttempt] = useState(0);
  const [contract, setContract] = useState<{ identity: string; data: TrainingPlanContract } | null>(null);
  const retryContract = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } });
    }, 30_000);
    void fetchTrainingPlanContract(kind, id, controller.signal).then(data => {
      if (!controller.signal.aborted) setContract({ identity, data });
    }).catch(() => {
      if (!controller.signal.aborted) setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } });
    }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, id, identity, attempt]);
  const refresh = () => { week.refresh(); schedule.refresh(); retryContract(); };
  const contractData = contract?.identity === identity ? contract.data : { months: {}, contractStatus: 'loading' };
  return {
    data: schedule.data ? { ...schedule.data, ...contractData } : null,
    subjects: week.data?.planSubjects,
    loading: week.loading || schedule.loading,
    error: week.error || schedule.error || (week.data && !week.data.planSubjects ? 'Module summaries could not be loaded.' : ''),
    refresh, retryContract,
  };
}
