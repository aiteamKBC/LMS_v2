import type { LearnerKind } from '@/api/learnerDetail';
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
  const profile = useCoachLearnerCaseFileData(args);
  const resolvedKind = profile.data?.kind || args.kind;
  const resolvedEnrolmentId = profile.data?.enrolmentId || args.enrolmentId;
  const hasEnrolmentIdentity = args.enabled && Boolean(resolvedKind && resolvedEnrolmentId);
  const hasProfileIdentity = args.enabled && Boolean(profile.data?.learnerId);
  const plan = useCaseFileDashboardPlan(resolvedKind, resolvedEnrolmentId, hasEnrolmentIdentity, args.activeTab === 'overview' || args.activeTab === 'support');
  const attendance = useCaseFileAttendance(resolvedKind, resolvedEnrolmentId, hasEnrolmentIdentity);
  const nextSession = useCaseFileNextSession(profile.data?.learnerId, hasProfileIdentity);
  const reviews = useCaseFileReviews(profile.data?.learnerId, hasProfileIdentity);
  const marking = useCaseFileMarking(resolvedEnrolmentId, hasEnrolmentIdentity && args.activeTab === 'assignments');
  return { ...profile, resolvedKind, resolvedEnrolmentId, plan, attendance, nextSession, reviews, marking };
}

