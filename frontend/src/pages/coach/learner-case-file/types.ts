import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import type { CoachReviewGenerationIssue } from '@/pages/coach/shared/calendarEvents';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import type { JourneyModule } from '@/utils/learnerJourney';
import type { CaseFileActivityStates } from './activityState';

interface CoachCompletedKsbDetail {
  code: string;
  type?: string;
  description?: string;
  sources?: Array<{
    id?: string;
    title?: string;
    typeLabel?: string;
    kind?: string;
    source?: string;
    activityId?: string;
    completedAt?: string;
    status?: string;
    module?: string;
  }>;
}

export interface CoachCaseloadLearner {
  id: string;
  name: string;
  initials: string;
  learnerType?: LearnerKind | null;
  enrolmentId?: string | null;
  employer: string;
  cohortId: string;
  cohortName: string;
  group: string;
  status: 'at-risk' | 'on-track' | 'high' | 'new-starter';
  enrollmentStatus: string;
  riskFlags: string[];
  overallProgress: number;
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
  otjhMinimum?: number;
  otjhPlanned?: number;
  otjhSubmitted?: number;
  otjhForecast?: number;
  otjhExpected?: number;
  otjhProgressHours?: string;
  otjhStatus?: string;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string;
  ksbCompletedDetails?: CoachCompletedKsbDetail[];
  ksbProgress: number;
  evidenceCount: number;
  nextCoaching: string;
  nextReview: string;
  lastContact: string;
  lastAttendanceDate: string;
  lastProgressReview: string;
  lastReview: string;
  lastCoachingSession: string;
  lastSubmittedEvidence: string;
  recentFlag: string | null;
  progressVariance: string;
  startDate: string;
  gatewayReviewDate: string;
  plannedEndDate: string;
  coachName?: string;
  coachEmail?: string;
  rawProgramStatus?: string;
  coachRag?: string;
  email?: string | null;
  employerEmail?: string | null;
  employerPhone?: string | null;
}

export interface CoachAttendanceLearner {
  id: string;
  learner: string;
  initials: string;
  learnerType?: LearnerKind | null;
  enrolmentId?: string | null;
  email?: string | null;
  programme: string;
  cohort: string;
  group: string;
  programStatus?: string;
  enrollmentStatus?: string;
  isOnBreak?: boolean;
  includedInAttendanceMetrics?: boolean;
  attendance: number | null;
  sessions: number | null;
  present: number | null;
  absent: number | null;
  late: number | null;
  catchup: number | null;
  trend: 'up' | 'down' | 'stable';
  risk: 'red' | 'amber' | 'green' | null;
  employer: string;
  overallProgress: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  lastSession: string;
  lastSessionDate?: string | null;
  nextSession: string;
  consecutiveMissed: number | null;
  hasAttendance: boolean;
}

export interface CaseFileActivityItem {
  id: string;
  date: string;
  event: string;
  detail: string;
  tone: 'primary' | 'accent' | 'emerald' | 'amber' | 'red';
}

export interface CoachMarkingQueueItem {
  id: string;
  learnerId: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme: string;
  group: string;
  status: string;
  enrollmentStatus: string;
  isOnBreak: boolean;
  pendingEvidence: number;
  acceptedEvidence: number;
  referredEvidence: number;
  referredClosure: number;
  totalEvidence: number;
  elapsedDays: number;
  isOverdue: boolean;
  lastSubmission: string;
  lastSubmissionIso?: string | null;
  startDate: string;
  module: string | null;
  title: string | null;
  type: string | null;
  due: string | null;
  words: number | null;
  activityId?: string | null;
  activityTitle?: string | null;
  submittedAt?: string | null;
}

export interface CaseFileUpcomingSession {
  id: string;
  kind: 'live' | 'review';
  status: CoachCalendarEvent['status'];
  statusLabel: string;
  day: string;
  title: string;
  date: string;
  time: string;
  summary: string;
  detail: string;
}

export interface CaseFileReviewMeeting {
  id: string;
  eventKey: string;
  reviewInstanceId?: string | null;
  source: string;
  reviewTypeName: string;
  title: string;
  date: string;
  plannedDate: string;
  completedDate: string;
  time: string;
  detail: string;
  status: CoachCalendarEvent['status'];
  statusLabel: string;
  isNext: boolean;
  notes?: string;
  reviewer: string;
  hasForm: boolean;
  hasTranscript: boolean;
  hasAttendance: boolean;
}

export interface CaseFileReviewGroup {
  key: string;
  title: string;
  items: CaseFileReviewMeeting[];
}

export interface CoachLearnerCaseFileData {
  learnerId: string;
  /** enrolment."Created_users" id used by the learner workspace APIs. */
  enrolmentId: string | null;
  learnerIdentityIds?: string[];
  kind: LearnerKind | null;
  snapshot: CoachCaseloadLearner | null;
  attendance: CoachAttendanceLearner | null;
  evidence: CoachMarkingQueueItem | null;
  detail: LearnerDetail | null;
  journey: JourneyModule[];
  activityStates?: CaseFileActivityStates;
  peers: CoachCaseloadLearner[];
  displayName: string;
  initials: string;
  programme: string;
  employer: string;
  cohort: string;
  group: string;
  email: string;
  programStatus: string;
  coachName: string;
  coachEmail: string;
  coachRag?: string | null;
  employerEmail: string;
  employerPhone: string;
  overallProgress: number | null;
  attendanceRate: number | null;
  attendancePresentCount: number | null;
  attendanceSessionCount: number | null;
  attendanceAbsentCount: number | null;
  otjhCompleted: number | null;
  otjhTarget: number | null;
  otjhPlanned: number | null;
  ksbProgress: number | null;
  metricsAvailable?: boolean;
  ksbStatus?: 'ready' | 'empty' | 'unavailable';
  ksbEvidencedCount: number | null;
  ksbTotalCount: number | null;
  mappedKsbCodes: string[];
  ksbCodeProgress: Array<{ code: string; completed: number; total: number }>;
  evidenceCount: number | null;
  startDate: string;
  gatewayReviewDate: string;
  plannedEndDate: string;
  totalExpectedOtjh: number;
  touchedKsbCodes: string[];
  activityItems: CaseFileActivityItem[];
  upcomingSessions: CaseFileUpcomingSession[];
  progressReviews: CaseFileReviewMeeting[];
  monthlyCoachMeetings: CaseFileReviewMeeting[];
  reviewGroups: CaseFileReviewGroup[];
  reviewGenerationIssues: CoachReviewGenerationIssue[];
  reviewsLoading: boolean;
  coachNotes?: string[];
}

export interface CaseFileOtjhMetrics {
  logged: number | null;
  target: number | null;
  programmeTotal: number | null;
  remaining: number | null;
  progressPercent: number | null;
}

export interface CaseFileTabProps {
  data: CoachLearnerCaseFileData;
}
