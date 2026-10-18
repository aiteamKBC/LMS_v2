import type { LearnerSummary } from '@/api/learnerDetail';
import type { OverviewWeek } from '@/api/learnerOverview';
import type { PlanModule, PlanReview, PlanSession } from '@/api/trainingPlanDashboard';
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
export type { DashboardHeader } from '@/api/dashboardHeader';
import type { DashboardHeader } from '@/api/dashboardHeader';
import { learnerHeaderPlan } from '@/pages/workspace/learner/learnerHeaderPlan';

import { upcomingEvents, upcomingReviewOrMcm } from '@/pages/learner/home/homeData';

/** Existing synthetic scenarios served through the V2 wire contract. */
export function dashboardHeaderFixture(legacy: LegacyDashboardHeader): DashboardHeader {
  const [session, deadline] = upcomingEvents(legacy.schedule, legacy.week);
  const review = upcomingReviewOrMcm(legacy.schedule);
  return {
    learner: legacy.learner, coach: legacy.schedule.coach,
    modules: learnerHeaderPlan(legacy.schedule.modules, {}, new Date(Date.now()).toISOString().slice(0, 10)).modules.map(({ id, title, subjectId }) => ({ id, title, ...(subjectId ? { subjectId } : {}) })),
    moduleLabel: learnerHeaderPlan(legacy.schedule.modules, {}, new Date(Date.now()).toISOString().slice(0, 10)).label,
    initialWeeklyModuleId: learnerHeaderPlan(legacy.weeklyCandidates || [], {}, new Date(Date.now()).toISOString().slice(0, 10)).modules[0]?.id || null,
    nextLiveSession: session.date ? { title: session.title,
      date: session.date, href: legacy.lectureHref || "/learner/attendance" } : null,
    nextAssignment: deadline.date ? { title: deadline.title, date: deadline.date, href: deadline.href } : null,
    nextReview: review ? { sessionId: review.sessionId, eventKey: review.eventKey, source: review.source,
      title: review.title, date: review.date!, scheduledDate: review.scheduledDate || undefined,
      scheduledTime: review.scheduledTime || undefined, meetingLink: review.meetingLink || undefined } : null,
  };
}
