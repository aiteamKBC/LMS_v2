import type { LearnerKind } from '@/api/learnerDetail';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCoachLearnerCaseFileData } from '@/pages/coach/learner-case-file/data';
import { useCaseFileAttendance } from '@/pages/coach/learner-case-file/useCaseFileAttendance';
import { useCaseFileDashboardPlan } from '@/pages/coach/learner-case-file/useCaseFileDashboardPlan';
import { useCaseFileMarking } from '@/pages/coach/learner-case-file/useCaseFileMarking';
import { useCaseFileNextSession } from '@/pages/coach/learner-case-file/useCaseFileNextSession';
import { useCaseFileReviews } from '@/pages/coach/learner-case-file/useCaseFileReviews';
import type { CaseFileTabId } from '@/pages/coach/learner-case-file/components/caseFileTabs.config';

type Args = {
  learnerId?: string | null;
  learnerName?: string | null;
  kind?: LearnerKind | null;
  enrolmentId?: string | null;
  enabled: boolean;
  activeTab: CaseFileTabId;
};

/** Owns the request graph after the shell has resolved the stable learner identity. */
export function useLearnerProfile(args: Args) {
  const session = useCaseFileSession();
  const profile = useCoachLearnerCaseFileData(args);
  const resolvedKind = profile.data?.kind || args.kind;
  const resolvedEnrolmentId = profile.data?.enrolmentId || args.enrolmentId;
  const hasEnrolmentIdentity = args.enabled && Boolean(resolvedKind && resolvedEnrolmentId);
  const hasProfileIdentity = args.enabled && Boolean(profile.data?.learnerId);
  const needsPlan = (session ? []
    : ['overview', 'weekly-learning', 'monthly-focus', 'progress', 'support']).includes(args.activeTab);
  const planSection = args.activeTab === 'support' ? 'learning-plan' : args.activeTab === 'progress' ? 'otjh-ksb'
    : needsPlan ? args.activeTab : 'overview';
  const plan = useCaseFileDashboardPlan(resolvedKind, resolvedEnrolmentId, hasEnrolmentIdentity, needsPlan, planSection);
  const attendance = useCaseFileAttendance(resolvedKind, resolvedEnrolmentId, hasEnrolmentIdentity, args.activeTab === 'attendance');
  const nextSession = useCaseFileNextSession(profile.data?.learnerId, !session && hasProfileIdentity);
  const reviews = useCaseFileReviews(profile.data?.learnerId, hasProfileIdentity, args.activeTab === 'reviews');
  const marking = useCaseFileMarking(resolvedEnrolmentId, !session && hasEnrolmentIdentity && args.activeTab === 'assignments');
  return { ...profile, resolvedKind, resolvedEnrolmentId, plan, attendance, nextSession, reviews, marking };
}

