import { useMemo } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import {
  fetchEmployerLearnerContract,
  fetchEmployerLearnerHours,
  fetchEmployerLearnerSchedule,
  fetchEmployerLearnerWeek,
} from '@/api/employerPortal';
import { useDashboardPlan, type DashboardPlanSources } from '@/pages/workspace/learner/useDashboardPlan';

const noPeek = () => undefined;

/** The learner's dashboard plan, sourced from the employer portal. */
export function useEmployerDashboardPlan(employerId: string, kind: LearnerKind, learnerId: string, enabled: boolean) {
  const sources = useMemo<DashboardPlanSources>(() => ({
    week: { read: (k, id, signal) => fetchEmployerLearnerWeek(employerId, k, id, signal), peek: noPeek },
    schedule: { read: (k, id, signal) => fetchEmployerLearnerSchedule(employerId, k, id, signal), peek: noPeek },
    contract: (k, id, signal) => fetchEmployerLearnerContract(employerId, k, id, signal),
    logSummary: (k, id, signal) => fetchEmployerLearnerHours(employerId, k, id, signal),
  }), [employerId]);
  return useDashboardPlan(kind, learnerId, enabled, sources);
}
