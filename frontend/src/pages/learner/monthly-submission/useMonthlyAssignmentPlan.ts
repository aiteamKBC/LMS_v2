import { useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { readLearnerJson } from '@/api/learnerRead';
import { subjectRequest } from '@/api/studentActivity';
import { fetchTrainingPlanContract, type TrainingPlanContract } from '@/api/trainingPlanDashboard';
import type { CoverMetadata } from '../my-learning/SubjectWorkspace';

type PlanState = {
  identity: string; metadata: CoverMetadata | null; contract: TrainingPlanContract | null;
  statuses: Record<string, string> | null; loading: boolean; errors: string[];
};

export function useMonthlyAssignmentPlan(kind?: LearnerKind, id?: string) {
  const identity = `${kind}:${id}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PlanState | null>(null);
  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    let active = true;
    setState({ identity, metadata: null, contract: null, statuses: null, loading: true, errors: [] });
    const query = new URLSearchParams({ learnerKind: kind, learnerId: id });
    void Promise.allSettled([
      subjectRequest<CoverMetadata>(`/learner_api/subject-covers/${encodeURIComponent(id)}/?refs=`, { signal: controller.signal, revalidate: attempt > 0 }),
      fetchTrainingPlanContract(kind, id, controller.signal),
      readLearnerJson<{ statuses: { activityType: string; activityId: string; status: string }[] }>(
        `/learner_api/reflection/submissions/?${query}`, { signal: controller.signal, revalidate: true }),
    ]).then(([dates, contract, submissions]) => {
      if (!active) return;
      const errors: string[] = [];
      if (dates.status === 'rejected') errors.push('Assignment dates could not be loaded.');
      if (contract.status === 'rejected' || ['unavailable', 'loading'].includes(contract.value.contractStatus)) {
        errors.push('Training Plan month details could not be loaded.');
      }
      const validStatuses = submissions.status === 'fulfilled' && Array.isArray(submissions.value.statuses);
      if (!validStatuses) errors.push('Submission statuses could not be loaded. You can still open saved work.');
      setState({ identity, loading: false, errors,
        metadata: dates.status === 'fulfilled' ? dates.value : null,
        contract: contract.status === 'fulfilled' ? contract.value : null,
        statuses: validStatuses ? Object.fromEntries(submissions.value.statuses
          .filter(row => row.activityType === 'assignment').map(row => [row.activityId, row.status])) : null,
      });
    }).finally(() => window.clearTimeout(timer));
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [kind, id, identity, attempt]);
  const current = state?.identity === identity ? state : null;
  return { metadata: current?.metadata || null, contract: current?.contract || null,
    statuses: current?.statuses || null, loading: current?.loading ?? Boolean(kind && id),
    errors: current?.errors || [], retry: () => setAttempt(value => value + 1) };
}
