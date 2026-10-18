import type { LearnerKind, LearnerSummary } from './learnerDetail';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

export type DashboardHeader = {
  coach: { name: string; email?: string; phone?: string | null };
  learner: Pick<LearnerSummary, 'id' | 'name' | 'programme' | 'cohort' | 'learnerStartDate' | 'learnerEndDate' | 'organization' | 'employer' | 'programmeStatus' | 'onboardingStatus' | 'firstSessionUnlocked' | 'accessGate' | 'learningAccess' | 'studentActivityAvailable'>;
  modules: { id: string; title: string; subjectId?: string }[];
  moduleLabel: string;
  initialWeeklyModuleId: string | null;
  nextReview: {
    sessionId: string; eventKey: string; source: 'mcr' | 'progress-review';
    title: string; date: string; scheduledDate?: string; scheduledTime?: string; meetingLink?: string;
  } | null;
  nextLiveSession: { title: string; date: string; href: string } | null;
  nextAssignment: { title: string; date: string; href: string } | null;
};
const headerPath = (kind: LearnerKind, id: string) => `/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/header/minimal/`;
const validHeader = (data: DashboardHeader | undefined): data is DashboardHeader =>
  !!data?.learner?.id && typeof data.learner.id === 'string' && typeof data.learner.name === 'string'
  && Array.isArray(data.modules) && typeof data.moduleLabel === 'string'
  && data.initialWeeklyModuleId !== undefined && data.nextReview !== undefined
  && data.nextLiveSession !== undefined && data.nextAssignment !== undefined;
export const dashboardHeader = {
  read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) => {
    const data = await readLearnerJson<DashboardHeader>(headerPath(kind, id), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!validHeader(data)) throw new Error('Dashboard Header response required.');
    return data;
  },
  peek: (kind: LearnerKind, id: string) => {
    const data = peekLearnerJson<DashboardHeader>(headerPath(kind, id));
    return validHeader(data) ? data : undefined;
  },
};
