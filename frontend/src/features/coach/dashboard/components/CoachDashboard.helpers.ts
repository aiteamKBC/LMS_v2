import type { ImportedReview } from '@/api/reviewHistory';
import type { EmbeddedCaseloadLearner } from '@/pages/coach/caseload/types';
import { type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { clearDashboardLearnerPageCache } from '../api/dashboardApi';
import { type DashboardPopupLearner } from '../api/dashboardSummary';

export type PerformanceStatus = 'on-track' | 'at-risk' | 'high' | 'new-starter';

export type ScheduleStatus = 'upcoming' | 'overdue' | 'needs-schedule' | 'none';


export interface CoachLearner {
  id: string;
  name: string;
  initials: string;
  /** 'commercial' | 'apprenticeship' — which learner_detail table this id resolves against. */
  learnerType?: 'commercial' | 'apprenticeship';
  aptemId?: string | null;
  /** enrolment."Created_users".id -- a different, disjoint pk space from `id`
   *  above. /learner-detail/ needs this one, not the LearnerProfile id. */
  enrolmentId?: string | null;
  /** Which module/week otjhTarget's cumulative-to-date figure currently falls in. */
  currentModule?: string | null;
  currentWeek?: string | null;
  componentsTargetToDate?: number | null;
  /** Whole-programme training-plan total used to calculate today's target. */
  otjhPlanned?: number | null;
  startDate?: string | null;
  plannedEndDate?: string | null;
  programme: string;
  programmeName?: string | null;
  cohortName?: string | null;
  group: string;
  employer: string;
  avatar: string;
  /** Legacy composite learner performance, not OTJH. See otjhRagStatus. */
  status: PerformanceStatus;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  attendanceAvailable?: boolean;
  activityProgress?: number | null;
  activityProgressAvailable?: boolean;
  componentsCompleted?: number | null;
  componentsPlanned?: number | null;
  attendancePresent?: number | null;
  attendanceSessions?: number | null;
  attendanceAbsent?: number | null;
  attendanceConsecutiveMissed?: number | null;
  attendanceLastSession?: string | null;
  attendanceLastSessionDate?: string | null;
  otjhCompleted: number;
  otjhTarget: number;
  otjhVariance?: number | null;
  otjhStatus?: string | null;
  otjhTargetAsOfToday?: number | null;
  otjhProgressAsOfToday?: number | null;
  otjhShortfallHours?: number | null;
  otjhDeltaHours?: number | null;
  otjhRagStatus?: 'at-risk' | 'need-attention' | 'on-track' | 'unavailable' | null;
  otjhRagSource?: string | null;
  ksbCompleted?: number | null;
  ksbTarget?: number | null;
  ksbProgress: number | null;
  ksbProgressAvailable?: boolean;
  /** Distinct KSB codes evidenced in the audit mapping. A count, not a
   *  percentage -- the mapping spans several standards, so it carries no
   *  per-learner denominator. Matches the learner's own workspace. */
  ksbEvidencedCount?: number | null;
  evidenceCount: number;
  evidenceCountAvailable?: boolean;
  evidenceCompletedCount: number;
  nextCoaching: string;
  nextCoachingStatus?: ScheduleStatus;
  nextReview: string;
  nextReviewStatus?: ScheduleStatus;
  lastContact: string;
  lastActivity?: string;
  lastActivityDate?: string | null;
  lastActivityLabel?: string;
  lastMcm?: string;
  lastPr?: string;
  recentFlag: string | null;
  email?: string | null;
  rawProgramStatus?: string | null;
  enrollmentStatus?: string | null;
  mcmReviews: ImportedReview[];
  reviews: ImportedReview[];
}


export type CaseloadApiLearner = EmbeddedCaseloadLearner & Partial<CoachLearner> & {
  cohortName?: string | null;
};


export interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}


export interface WeeklyCounts { progressReviews: number; monthlyCoaching: number; catchUps: number; reviewsAvailable: boolean }

export interface DashboardTotals {
  totalLearners: number;
  otjhAtRisk: number;
  needAttention: number;
  pendingMarking: number | null;
  prThisWeek: number | null;
  mcmThisWeek: number | null;
  catchUpsThisWeek: number;
}


export interface CoachDashboardApiResponse extends CaseloadApiResponse {
  popupLearners?: DashboardPopupLearner[];
  popupWeekEvents?: CoachCalendarEvent[];
  totals?: DashboardTotals;
  weeklyCounts?: WeeklyCounts;
  // Attendance is not a separate dataset: the backend overlays the one
  // canonical figure directly onto each learners[] entry
  // (attendanceRate/attendanceRateAvailable/attendanceLastSession*).
  meetings?: {
    events?: CoachCalendarEvent[];
    summary?: { progressReviewRows?: number; mcrRows?: number; learnersWithDates?: number; reviewAnchorSkipped?: number; reviewAnchorSkipReasons?: Record<string, number> };
    reviewGenerationIssues?: Array<{ learnerId?: string; code?: string }>;
  };
  marking?: MarkingQueueResponse;
  errors?: Record<string, string>;
}


export interface CachedCoachDashboard {
  popupLearners?: DashboardPopupLearner[];
  popupWeekEvents?: CoachCalendarEvent[];
  totals?: DashboardTotals;
  ownerName: string;
  learners: CoachLearner[];
  calendarEvents: CoachCalendarEvent[];
  calendarPreviewEvents: CoachCalendarEvent[];
  liveSessionEvents: CoachCalendarEvent[];
  evidenceQueue: EvidenceQueueLearner[];
  reviewGenerationAvailable: boolean;
  calendarError: string | null;
}


// Keep the last successful dashboard per signed-in account and effective coach.
// Route changes unmount this page, so component state alone would otherwise
// replace useful data with the full-page skeleton every time the coach returns.
export const dashboardSessionCache = new Map<string, CachedCoachDashboard>();

export const dashboardSectionSessionCache = new Map<string, CoachDashboardApiResponse>();


export function clearCoachDashboardSessionCache() {
  dashboardSessionCache.clear();
  dashboardSectionSessionCache.clear();
  clearDashboardLearnerPageCache();
}


export interface EvidenceQueueLearner {
  id: string;
  learnerId: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme: string;
  group: string;
  pendingEvidence: number;
  acceptedEvidence: number;
  referredEvidence: number;
  totalEvidence: number;
  lastSubmission: string;
  lastSubmissionIso?: string | null;
  submittedAt?: string | null;
  oldestPendingDate?: string | null;
  latestPendingDate?: string | null;
  isOverdue: boolean;
}


export interface MarkingQueueResponse {
  items?: Partial<EvidenceQueueLearner>[];
  summary?: {
    pendingItems?: number;
  };
}
