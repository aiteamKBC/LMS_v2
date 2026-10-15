import type { LearnerKind, LearnerSummary } from './learnerDetail';
import type { OverviewWeek } from './learnerOverview';
import type { PlanModule, PlanReview, PlanSession } from './trainingPlanDashboard';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

/** Persistent dashboard information, independent of the selected tab. */
export type DashboardHeader = {
  learner: Omit<LearnerSummary, 'email' | 'phone' | 'group' | 'employerId' | 'isActive'>;
  schedule: {
    coach: { name: string; email?: string; phone?: string | null };
    modules: (Pick<PlanModule, 'id' | 'title' | 'start_date' | 'end_date'> & { subjectId?: string })[];
    sessions: Pick<PlanSession, 'id' | 'moduleId' | 'title' | 'start' | 'status'>[];
    reviews: Pick<PlanReview, 'id' | 'eventKey' | 'title' | 'source' | 'status' | 'date' | 'targetDate' | 'scheduledDate' | 'scheduledTime' | 'meetingLink'>[];
  };
  week: Pick<OverviewWeek, 'deadlines'>;
  lectureHref: string | null;
  /** Eligible module candidates retain browser locale sorting for the default week. */
  weeklyCandidates?: Pick<PlanModule, 'id' | 'title' | 'start_date' | 'end_date'>[];
};

const path = (kind: LearnerKind, id: string) => `/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/header/`;
export const dashboardHeader = {
  read: (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) =>
    readLearnerJson<DashboardHeader>(path(kind, id), { signal, revalidate: fresh, ttlMs: 30_000 }),
  peek: (kind: LearnerKind, id: string) => peekLearnerJson<DashboardHeader>(path(kind, id)),
};
