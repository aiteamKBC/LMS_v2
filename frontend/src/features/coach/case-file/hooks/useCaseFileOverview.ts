import { useEffect, useState } from 'react';
import { useCaseFileSession } from './CaseFileSession';
import type { CoverMetadata, LearningSummaryActivity, LearningSummaryDetail } from '@/pages/learner/my-learning/learningSummary';
import type { PlanModule, PlanSession, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { PlanSubjectSummary } from '@/api/learnerOverview';
export type LegacyModuleOverview = Pick<TrainingPlanDashboard, 'moduleLinks' | 'actual' | 'actualAvailable' | 'moduleProgress'> & {
  learning: { detail: LearningSummaryDetail; activity: LearningSummaryActivity | null; metadata: CoverMetadata };
  modules: Pick<PlanModule, 'id' | 'title' | 'start_date' | 'end_date' | 'total_otjh'>[];
  sessions: Omit<PlanSession, 'joinUrl'>[];
};
export type ModuleOverviewIndex = Pick<LegacyModuleOverview, 'modules' | 'moduleLinks'> & { subjects: PlanSubjectSummary[] };
export type CaseFileOverview = {
  wholeProgrammeProgress: {
    overall: { completed: number; total: number; percent: number | null };
    attendance: { present: number | null; sessions: number | null; percent: number | null };
    otjh: { actual: number | null; targetToDate: number | null; planned: number | null; percent: number | null };
    ksb: { completed: number; total: number; percent: number | null };
  };
  programmeProgress: { id: string; title: string; percent: number | null }[];
  moduleIndex?: ModuleOverviewIndex;
  // Accept an older server's response during a rolling deployment.
  moduleOverview?: LegacyModuleOverview;
};

export function useCaseFileOverview() {
  const session = useCaseFileSession();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ session?: typeof session; data?: CaseFileOverview; error?: string }>({});
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setState({});
    void session.read<CaseFileOverview>('overview', {}, { signal: controller.signal, refresh: attempt > 0 }).then(data => {
      if (!controller.signal.aborted) setState({ session, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ session, error: error instanceof Error ? error.message : 'Unable to load overview.' });
    });
    return () => controller.abort();
  }, [session, attempt]);
  const current = state.session === session ? state : {};
  return { data: current.data, error: current.error, retry: () => setAttempt(value => value + 1) };
}
