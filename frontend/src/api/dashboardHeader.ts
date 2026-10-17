import type { LearnerKind, LearnerSummary } from './learnerDetail';
import type { OverviewWeek } from './learnerOverview';
import type { PlanModule, PlanReview, PlanSession } from './trainingPlanDashboard';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

/** Persistent dashboard information, independent of the selected tab. */
export type LegacyDashboardHeader = {
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

export type DashboardHeader = {
  version: 2;
  learner: LegacyDashboardHeader['learner'];
  coach: LegacyDashboardHeader['schedule']['coach'];
  modules: LegacyDashboardHeader['schedule']['modules'];
  weeklyCandidates: NonNullable<LegacyDashboardHeader['weeklyCandidates']>;
  nextReview: {
    sessionId: string; eventKey: string; source: 'mcr' | 'progress-review';
    title: string; date: string; scheduledDate?: string; scheduledTime?: string; meetingLink?: string;
  } | null;
  nextLiveSession: { id: string; moduleId: string; title: string; date: string; href: string | null } | null;
  nextDeadline: { id: string; title: string; date: string; href: string } | null;
};

const path = (kind: LearnerKind, id: string) => `/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/header/`;
const headers = { 'X-LMS-Header-Version': '2' };
export const dashboardHeader = {
  read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) => {
    const response = await readLearnerJson<DashboardHeader>(path(kind, id), { headers, signal, revalidate: fresh, ttlMs: 30_000 });
    if (response?.version !== 2) throw new Error('Dashboard Header V2 response required.');
    return response;
  },
  peek: (kind: LearnerKind, id: string) => {
    const response = peekLearnerJson<DashboardHeader>(path(kind, id), { headers });
    return response?.version === 2 ? response : undefined;
  },
};
