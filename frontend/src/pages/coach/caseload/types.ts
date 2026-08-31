// ============================================================================
// Coach caseload — data contracts.
//
// These mirror what `/coach_api/coach/caseload` and `/coach_api/coach/attendance`
// actually return. Several fields the API has always sent were previously
// untyped and therefore unused (otjhProgressHours, the KSB breakdown, the
// attendance detail counts); they are declared here because the redesign reads
// them instead of re-deriving weaker approximations on the client.
//
// Fields Django currently hard-codes to "--" (employer, nextReview,
// nextCoaching, lastContact, the last* dates) are kept in the types so nothing
// existing breaks, but the UI treats them as absent rather than inventing
// values for them.
// ============================================================================

export type PerformanceStatus = 'at-risk' | 'on-track' | 'high' | 'new-starter';
export type EnrollmentStatus = 'all' | 'active' | 'break' | 'withdrawn' | 'ready-to-enrol' | 'unknown';
export type AttendanceRisk = 'green' | 'amber' | 'red';

/** Which slice of the caseload the status pills are showing. */
export type StatusFilter =
  | 'all'
  | 'at-risk'
  | 'need-attention'
  | 'upcoming'
  | 'on-track'
  | 'break'
  | 'needs-action';

export type SortKey =
  | 'risk'
  | 'name'
  | 'progress'
  | 'attendance'
  | 'otjh'
  | 'components'
  | 'ksb'
  | 'gateway';

export type SortDirection = 'asc' | 'desc';

/** Tabs inside the quick-view drawer. */
export type QuickViewTab = 'overview' | 'attendance' | 'otjh' | 'ksbs';

export interface Learner {
  id: string;
  name: string;
  initials: string;
  /** 'commercial' | 'apprenticeship' — which learner_detail table this id resolves against. */
  learnerType?: 'commercial' | 'apprenticeship';
  /** enrolment."Created_users".id -- a different, disjoint pk space from `id`
   *  above (which is this LearnerProfile's own id). /learner-detail/ needs this one. */
  enrolmentId?: string | null;
  /** Which module/week otjhTarget's cumulative-to-date figure currently falls in. */
  currentModule?: string | null;
  currentWeek?: string | null;
  /** Components expected by now, same pacing as otjhTarget -- not componentsPlanned's whole-plan total. */
  componentsTargetToDate?: number | null;
  employer: string;
  cohortId: string;
  cohortName: string;
  /** Programme label. Present on the attendance payload; falls back to cohort. */
  programmeName?: string;
  group: string;
  status: PerformanceStatus;
  enrollmentStatus: EnrollmentStatus;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  /** Component completion percentage. Misleadingly named on the wire. */
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  componentsCompleted?: number;
  componentsPlanned?: number;

  otjhCompleted: number;
  /** Cumulative planned hours up to and including the current week. */
  otjhTarget: number;
  /** Total planned hours for the whole programme. */
  otjhPlanned?: number;
  otjhMinimum?: number;
  /** completed - target, as a string. Negative means behind the current target. */
  otjhProgressHours?: string;
  otjhStatus?: string;

  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string;
  ksbProgress: number;
  ksbProgressAvailable?: boolean;
  knowledgeCompleted?: number;
  knowledgeTarget?: number;
  knowledgeProgress?: number;
  skillsCompleted?: number;
  skillsTarget?: number;
  skillsProgress?: number;
  behavioursCompleted?: number;
  behavioursTarget?: number;
  behavioursProgress?: number;

  evidenceCount: number;
  evidenceCompletedCount?: number;
  evidenceCountAvailable?: boolean;

  // Live attendance, joined in from /coach_api/coach/attendance.
  liveAttendanceRate?: number | null;
  liveAttendanceRateAvailable?: boolean;
  attendanceSessions?: number | null;
  attendancePresent?: number | null;
  attendanceAbsent?: number | null;
  attendanceLate?: number | null;
  attendanceAuthorisedAbsent?: number | null;
  attendanceUnauthorisedAbsent?: number | null;
  attendanceCatchup?: number | null;
  attendanceRisk?: AttendanceRisk | null;
  attendanceConsecutiveMissed?: number | null;
  attendanceLastSession?: string;
  attendanceLastSessionDate?: string | null;

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
  email?: string;
  employerEmail?: string;
  employerPhone?: string;
}

export interface CaseloadApiLearner extends Omit<Learner, 'enrollmentStatus' | 'email' | 'employerEmail' | 'employerPhone' | 'progressVariance' | 'startDate' | 'gatewayReviewDate' | 'plannedEndDate'> {
  enrollmentStatus: Exclude<EnrollmentStatus, 'all'>;
  email?: string | null;
  employerEmail?: string | null;
  employerPhone?: string | null;
  progressVariance?: string;
  startDate?: string;
  gatewayReviewDate?: string;
  plannedEndDate?: string;
}

export interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}

export interface AttendanceApiLearner {
  id: string;
  learner: string;
  email?: string | null;
  programme?: string | null;
  attendance: number | null;
  sessions: number | null;
  present?: number | null;
  absent?: number | null;
  late?: number | null;
  catchup?: number | null;
  authorisedAbsent?: number | null;
  unauthorisedAbsent?: number | null;
  risk?: string | null;
  lastSession?: string | null;
  lastSessionDate?: string | null;
  consecutiveMissed?: number | null;
  hasAttendance: boolean;
}

export interface AttendanceApiResponse {
  learners?: AttendanceApiLearner[];
}

export interface FilterOption {
  value: string;
  label: string;
}
