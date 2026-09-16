import type { LearnerKind } from './learnerDetail';
import type { TrainingPlanDashboard } from './trainingPlanDashboard';
import type { LearnerMetrics } from './learnerMetrics';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

export type PlanSubjectSummary = {
  id: string; title: string; source: 'legacy' | 'current'; completed: number; total: number;
  dates: string[]; moduleIds: string[]; sessionTitles: { date: string; title: string }[];
  activityCounts?: Record<string, number>; ksbCodes?: string[]; ksbMappingMissing?: boolean;
  ksbProgress?: { completed: number; total: number } | null;
  directHours?: number | null;
};

export type OverviewWeek = {
  metrics?: LearnerMetrics;
  planSubjects?: PlanSubjectSummary[];
  monthlyOtjh?: Record<string, { planned: number | null; actual: number; missingPlannedActivities: number }>;
  weekStart: string; weekEnd: string; timezone: string;
  modules: { id: string; title: string; weekLabels: string[]; moduleIds?: string[]; completed: number; total: number;
    percent: number | null; ksbCodes: string[]; ksbMappingMissing: boolean }[];
  deadlines: { id: string; title: string; type: 'assignment' | 'checkpoint'; date: string; subjectId: string }[];
  undatedActivities: number; expectedHours: number | null; missingExpectedHours: number;
  otjh: { actual: number | null; historical: number | null; new: number; undatedHistoricalRows: number };
};

export type HomeProgressCount = { completed: number; total: number };
export type HomeProgress = {
  period: { start: string | null; end: string; timezone: string };
  otjh: { actual: number | null; submitted: number | null; planned: number | null; percent: number | null; missingPlannedActivities: number };
  activities: HomeProgressCount | null; assignments: HomeProgressCount | null;
  lectures: HomeProgressCount | null; modules: HomeProgressCount;
  undatedActivities: number;
};
export type OverviewHome = OverviewWeek & { homeProgress: HomeProgress };

function resource<T>(path: (kind: LearnerKind, id: string) => string, valid: (value: T) => boolean) {
  return {
    read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) => {
      const value = await readLearnerJson<T>(path(kind, id), { signal, revalidate: fresh, ttlMs: 30_000 });
      if (!value || !valid(value)) throw new Error('Could not load your overview. Please try again.');
      return value;
    },
    peek: (kind: LearnerKind, id: string) => {
      const value = peekLearnerJson<T>(path(kind, id));
      return value && valid(value) ? value : undefined;
    },
  };
}
const weekPath = (kind: LearnerKind, id: string) => `/learner_api/overview-week/${kind}/${encodeURIComponent(id)}/`;
export const overviewWeek = resource<OverviewWeek>(weekPath, value => !!value.weekStart && Array.isArray(value.modules) && Array.isArray(value.deadlines) && !!value.otjh);
export const overviewDashboard = resource<OverviewWeek>((kind, id) => `${weekPath(kind, id)}?section=dashboard`,
  value => !!value.weekStart && Array.isArray(value.modules) && Array.isArray(value.deadlines) && !!value.otjh && !!value.metrics);
export const overviewHome = resource<OverviewHome>((kind, id) => `${weekPath(kind, id)}?section=home`,
  value => !!value.weekStart && Array.isArray(value.modules) && Array.isArray(value.deadlines)
    && !!value.homeProgress?.otjh && !!value.homeProgress.period && !!value.homeProgress.modules);
export const overviewSchedule = resource<TrainingPlanDashboard>(
  (kind, id) => `/learner_api/training-plan-dashboard/${kind}/${encodeURIComponent(id)}/?section=overview`,
  value => Array.isArray(value.sessions) && Array.isArray(value.reviews),
);

export type LearningSchedule = Pick<TrainingPlanDashboard, 'modules' | 'moduleLinks' | 'generatedAt'>;
export const learningSchedule = resource<LearningSchedule>(
  (kind, id) => `/learner_api/training-plan-dashboard/${kind}/${encodeURIComponent(id)}/?section=learning`,
  value => Array.isArray(value.modules) && !!value.moduleLinks,
);
