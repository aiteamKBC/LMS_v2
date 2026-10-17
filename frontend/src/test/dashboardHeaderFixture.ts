import type { DashboardHeader, LegacyDashboardHeader } from '@/api/dashboardHeader';
import { upcomingEvents, upcomingReviewOrMcm } from '@/pages/learner/home/homeData';

/** Existing synthetic scenarios served through the V2 wire contract. */
export function dashboardHeaderFixture(legacy: LegacyDashboardHeader): DashboardHeader {
  const [session, deadline] = upcomingEvents(legacy.schedule, legacy.week);
  const review = upcomingReviewOrMcm(legacy.schedule);
  return {
    version: 2, learner: legacy.learner, coach: legacy.schedule.coach,
    modules: legacy.schedule.modules, weeklyCandidates: legacy.weeklyCandidates || [],
    nextLiveSession: session.date ? { id: session.id, moduleId: session.moduleId!, title: session.title,
      date: session.date, href: legacy.lectureHref } : null,
    nextDeadline: deadline.date ? { id: deadline.id, title: deadline.title, date: deadline.date, href: deadline.href } : null,
    nextReview: review ? { sessionId: review.sessionId, eventKey: review.eventKey, source: review.source,
      title: review.title, date: review.date!, scheduledDate: review.scheduledDate || undefined,
      scheduledTime: review.scheduledTime || undefined, meetingLink: review.meetingLink || undefined } : null,
  };
}
