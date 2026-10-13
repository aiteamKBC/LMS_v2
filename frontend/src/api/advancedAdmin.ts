import type { StudentActivityResponse, SubjectMaterial } from './studentActivity';
import type { LearnerComponentEntry, LearnerDetail } from './learnerDetail';
import type { ReviewFormResponse } from './reviewForm';
import type { TrainingPlanDashboard } from './trainingPlanDashboard';

export interface AdvancedAdminLearner {
  id: number;
  name: string;
  programme: string;
  programmeCode: 'PCP' | 'ME';
  programmeStatus: string;
  cohort: string;
  group: string;
  coach: string;
  lmsLinked: boolean;
  email?: string;
  learnerType?: string | null;
  enrolmentId?: number | null;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/login_api/advanced-admin/${path}`, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Could not load learner data.');
  return payload as T;
}

export const advancedAdminLearners = (signal?: AbortSignal) =>
  get<{ count: number; learners: AdvancedAdminLearner[] }>('learners/', signal);

export const advancedAdminLearner = (id: number, signal?: AbortSignal) =>
  get<{ learner: AdvancedAdminLearner }>(`learners/${id}/`, signal);

export const advancedAdminLearning = (id: number, signal?: AbortSignal) =>
  get<{ current: LearnerDetail; historical: StudentActivityResponse }>(`learners/${id}/learning/`, signal);

export interface AdvancedAdminWordPressCourse {
  id: number;
  title: string;
  completedActivities: number;
  startedActivities: number;
  activities: { id: number; title: string; type: string; completed: boolean; started: boolean }[];
}

export const advancedAdminWordPressCourses = (id: number, signal?: AbortSignal) =>
  get<{ courses: AdvancedAdminWordPressCourse[]; source: 'wordpress-live' }>(
    `learners/${id}/learning/wordpress-courses/`, signal);

export type AdvancedAdminModuleProgress = Pick<TrainingPlanDashboard,
  'modules' | 'moduleLinks' | 'moduleProgress' | 'months' | 'programmeStartDate' |
  'programmeEndDate' | 'actual' | 'actualAvailable' | 'sessions'> &
  { targetAsOfToday: number | null };

export const advancedAdminModuleProgress = (id: number, signal?: AbortSignal) =>
  get<{ progress: AdvancedAdminModuleProgress }>(`learners/${id}/module-progress/`, signal);

export const advancedAdminComponent = (id: number, componentId: string, signal?: AbortSignal) =>
  get<{ component: LearnerComponentEntry }>(`learners/${id}/learning/components/${encodeURIComponent(componentId)}/`, signal);

export const advancedAdminComponentFileUrl = (id: number, componentId: string, slot: string) =>
  `/login_api/advanced-admin/learners/${id}/learning/components/${encodeURIComponent(componentId)}/files/${encodeURIComponent(slot)}/`;

export interface AdvancedAdminQuizReview {
  body: string;
  questions: { id: string; text: string; options: string[];
    correctAnswers: string[]; learnerAnswers: string[] }[];
}

export const advancedAdminMaterial = (id: number, groupId: number, activityId: number, signal?: AbortSignal) =>
  get<SubjectMaterial & { has_quiz_review: boolean }>(`learners/${id}/learning/material/${groupId}/${activityId}/`, signal);

export const advancedAdminLegacyQuizReview = (id: number, kind: 'material' | 'quiz', groupId: number,
  activityId: number, signal?: AbortSignal) =>
  get<{ quiz: AdvancedAdminQuizReview | null }>(
    `learners/${id}/learning/quiz-review/${kind}/${groupId}/${activityId}/`, signal);

export const advancedAdminComponentQuizReview = (id: number, componentId: string, signal?: AbortSignal) =>
  get<{ quiz: AdvancedAdminQuizReview }>(
    `learners/${id}/learning/components/${encodeURIComponent(componentId)}/quiz-review/`, signal);

export interface AdvancedAdminSubmission {
  id: string;
  activityId?: string;
  planMonth?: string | null;
  activityTitle: string;
  activityType: string;
  module: string;
  status: string;
  plannedOtjh?: string | number | null;
  actualTimeHours?: string | number | null;
  ksbCodes?: string[];
  submissionAttempts?: import('./assignmentAttempts').SubmissionAttempt[];
  submittedAt: string | null;
  dateCompleted: string | null;
  learningReflection: string;
  applicationText: string;
  evidenceFiles: unknown[];
  coachFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface AdvancedAdminEvidence {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  sectionRef: string;
  uploadedAt: string | null;
}

export interface AdvancedAdminAttendance {
  sessionId?: string;
  date: string | null;
  status: string;
  title: string;
  module: string;
}

export interface AdvancedAdminInclusionNote {
  id: string;
  type: string;
  note: string;
  createdAt: string | null;
  createdBy: string;
}

export interface AdvancedAdminInclusionEvidence {
  id: string;
  fileName: string;
  url: string;
}

export interface AdvancedAdminInclusionReport {
  id: string;
  status: string;
  riskLevel: string | null;
  progressTier: number | null;
  programme: string;
  organisation: string;
  coach: string;
  archived: boolean;
  createdAt: string | null;
  reportHeader: unknown;
  overview: unknown;
  executiveSummary: unknown;
  keyFindings: unknown;
  supportPlan: unknown;
  priorityActions: unknown;
  riskRoadmap: unknown;
  reviewTimeline: unknown;
  managerBrief: unknown;
  professionalNote: unknown;
  sections: Record<string, unknown>;
  notes: AdvancedAdminInclusionNote[];
  evidence: AdvancedAdminInclusionEvidence[];
}

export interface AdvancedAdminInclusionTicket {
  id: string;
  sourceReportId: string | null;
  subject: string;
  details: string;
  status: string;
  riskLevel: string | null;
  progressTier: number | null;
  archived: boolean;
  createdAt: string | null;
  notes: AdvancedAdminInclusionNote[];
  evidence: AdvancedAdminInclusionEvidence[];
}

export interface AdvancedAdminSupportTicket {
  id: number;
  ticketType: string;
  subject: string;
  details: string;
  status: string;
  statusLabel: string;
  assignedOwner: string;
  createdAt: string | null;
  archived: boolean;
  notes: AdvancedAdminInclusionNote[];
  evidence: AdvancedAdminInclusionEvidence[];
}

export const advancedAdminSubmissions = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminSubmission[] }>(`learners/${id}/submissions/`, signal);

export interface AdvancedAdminLegacyAssignment {
  id: string;
  activityTitle: string;
  moduleTitle: string;
  status: string;
  dateCompleted: string | null;
  submittedAt: string | null;
  monthlyAssignment: { month: string };
  legacyAssignment: {
    evidenceIds: number[];
    documents: { evidenceId: number; part: 'file' | 'report'; name: string }[];
    feedbacks: unknown[];
    lmsReviews?: { decision: string; feedback: string; reviewedBy: string; reviewedAt: string }[];
  };
}

export const advancedAdminLegacyAssignments = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminLegacyAssignment[] }>(`learners/${id}/legacy-assignments/`, signal);

export interface AdvancedAdminAuditEvidence {
  id: number;
  name: string;
  status: string;
  submittedAt: string | null;
  completedAt: string | null;
  feedbacks: unknown[];
  hasFile: boolean;
  hasReport: boolean;
  note: string;
  verifiedKsbCodes: string[];
  reviews: { decision: string; feedback: string; reviewedBy: string; reviewedAt: string }[];
}

export interface AdvancedAdminAuditAssignment {
  componentId: number;
  rowId?: string;
  name: string;
  type: string;
  month: string | null;
  monthSource?: 'upload' | 'audit';
  reportHoursStatus?: string;
  missingReportHours?: number;
  status: string;
  plannedHours: number | null;
  actualHours: number | null;
  evidence: AdvancedAdminAuditEvidence[];
  sourceFiles?: { name: string; url: string | null }[];
  sourceMarkId?: number | null;
  sourceReviews?: { decision: string; feedback: string; reviewedBy: string; reviewedAt: string }[];
}

export const advancedAdminAuditAssignments = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminAuditAssignment[] }>(`learners/${id}/audit-assignments/`, signal);

export interface AdvancedAdminAssignmentUpload {
  id: string;
  month: string;
  title: string;
  actualHours: number;
  filename: string;
  uploadedAt: string;
}

export const advancedAdminAssignmentUploads = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminAssignmentUpload[] }>(`learners/${id}/assignment-uploads/`, signal);

export const advancedAdminAssignmentUploadUrl = (id: number, recordId: string) =>
  `/login_api/advanced-admin/learners/${id}/assignment-uploads/${recordId}/open/`;

export async function advancedAdminUploadAssignment(id: number, month: string, hours: string, file: File) {
  const { csrfToken } = await get<{ csrfToken: string }>('csrf/');
  const body = new FormData();
  body.set('month', month);
  body.set('hours', hours);
  body.set('file', file);
  const response = await fetch(`/login_api/advanced-admin/learners/${id}/assignment-uploads/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Could not record assignment.');
  return payload as { id: string; created: boolean };
}

export const advancedAdminAuditAssignmentDocument = (id: number, evidenceId: number, part: 'file' | 'report') =>
  get<{ url: string }>(`learners/${id}/audit-assignments/evidence/${evidenceId}/${part}/open/`);

export async function advancedAdminAuditAssignmentMark(id: number, evidenceId: number, decision: string, feedback: string) {
  const { csrfToken } = await get<{ csrfToken: string }>('csrf/');
  const response = await fetch(`/login_api/advanced-admin/learners/${id}/audit-assignments/evidence/${evidenceId}/mark/`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ decision, feedback }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Could not save assignment marking.');
  return payload as { id: number; status: string; reviewedAt: string };
}

export async function advancedAdminAuditAssignmentSourceMark(id: number, recordId: number, decision: string, feedback: string) {
  const { csrfToken } = await get<{ csrfToken: string }>('csrf/');
  const response = await fetch(`/login_api/advanced-admin/learners/${id}/audit-assignments/check/${recordId}/mark/`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ decision, feedback }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Could not save imported assignment marking.');
  return payload as { id: number; status: string; reviewedAt: string };
}

export const advancedAdminLegacyDocument = (id: number, evidenceId: number, part: 'file' | 'report') =>
  get<{ url: string; downloadUrl: string }>(`learners/${id}/legacy-assignments/${evidenceId}/${part}/open/`);

export async function advancedAdminLegacyMark(id: number, evidenceId: number, decision: string, feedback: string) {
  const { csrfToken } = await get<{ csrfToken: string }>('csrf/');
  const response = await fetch(`/login_api/advanced-admin/learners/${id}/legacy-assignments/${evidenceId}/mark/`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ decision, feedback }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Could not save historical marking decision.');
  return payload as { id: number; status: string; reviewedAt: string };
}

export const advancedAdminEvidence = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminEvidence[] }>(`learners/${id}/evidence/`, signal);

export interface AdvancedAdminMonthlyReport {
  id: string;
  month: string;
  monthLabel: string;
  status: string;
  learnedSummary: string;
  attachments: { id?: string; filename?: string; name?: string }[];
  submittedAt: string | null;
  signedName: string | null;
}

export const advancedAdminMonthlyReports = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminMonthlyReport[] }>(`learners/${id}/monthly-reports/`, signal);

export const advancedAdminEvidenceDownload = (id: number, fileId: string) =>
  get<{ url: string }>(`learners/${id}/evidence/${fileId}/download/`);

export const advancedAdminAttendance = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminAttendance[] }>(`learners/${id}/attendance/`, signal);

export interface AdvancedAdminLecture {
  id: string;
  sessionId: string;
  date: string;
  title: string;
  moduleId: string;
  module: string;
  source: 'kbc-attendance' | 'microsoft-teams';
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  tutor: string;
  coach: string;
  contentSummary: string;
  ksbs: string[];
  activities: { id: string; title: string; type: string; completed: boolean }[];
  status: string;
  catchupStatus: 'completed' | 'pending' | 'missed' | null;
}

export interface AdvancedAdminLectureWorkspace {
  lectures: AdvancedAdminLecture[];
  modules: { id: string; title: string }[];
  mode: {
    available: boolean;
    mode: 'live' | 'lazy';
    requestedMode: 'lazy' | null;
    status: string;
    plannedLiveHours?: number;
    plannedRecordedHours?: number;
  };
  recentActivity: { id: string; title: string; at: string; type: string }[];
  timeZone: string;
}

export const advancedAdminLectureWorkspace = (id: number, signal?: AbortSignal) =>
  get<AdvancedAdminLectureWorkspace>(`learners/${id}/lecture-workspace/`, signal);

export interface AdvancedAdminEnrolment {
  summary: Record<string, unknown>;
  answers: Record<string, unknown>;
  wizardDraft: Record<string, unknown>;
  completed: boolean;
}
export const advancedAdminEnrolment = (id: number, signal?: AbortSignal) =>
  get<AdvancedAdminEnrolment>(`learners/${id}/enrolment/`, signal);

export interface AdvancedAdminComplianceDocument {
  id: string;
  type: string;
  filename: string;
  signed: boolean;
  generatedAt: string | null;
}
export const advancedAdminCompliance = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminComplianceDocument[] }>(`learners/${id}/compliance/`, signal);
export const advancedAdminComplianceFile = (id: number, documentId: string) =>
  get<{ url: string }>(`learners/${id}/compliance/${encodeURIComponent(documentId)}/open/`);

export interface AdvancedAdminConversation {
  id: number;
  coach: string;
  messages: { id: number; sender: string; body: string; createdAt: string }[];
}
export const advancedAdminMessages = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminConversation[] }>(`learners/${id}/messages/`, signal);

export interface AdvancedAdminMonthlyLog {
  month: string;
  status: string;
  row_count: number;
  planned_hours: number;
  actual_hours: number | string;
  not_accepted_hours: number | string;
  training_plan_target: number | string | null;
  student_signature: { signer_name?: string; signed_at?: string } | null;
  coach_signature: { signer_name?: string; signed_at?: string } | null;
}
export const advancedAdminMonthlyLogs = (id: number, signal?: AbortSignal) =>
  get<{ months: AdvancedAdminMonthlyLog[]; totalMonths: number; completedMonths: number;
    trainingPlanTotals?: { accepted_hours: number | null; planned_hours: number | null } }>(`learners/${id}/monthly-logs/`, signal);

export const advancedAdminInclusion = (id: number, signal?: AbortSignal) =>
  get<{ reports: AdvancedAdminInclusionReport[]; tickets: AdvancedAdminInclusionTicket[]; supportTickets: AdvancedAdminSupportTicket[] }>(`learners/${id}/inclusion/`, signal);

export const advancedAdminInclusionReportPdf = (learnerId: number, reportId: string) =>
  `/login_api/advanced-admin/learners/${learnerId}/inclusion/reports/${encodeURIComponent(reportId)}/pdf/`;

export interface AdvancedAdminCoachingSession {
  id: string;
  componentId: number | null;
  family: 'pr' | 'mcm';
  plannedDate: string | null;
  actualStartAt: string | null;
  status: string;
  aiStatus: string;
  report: Record<string, unknown> | null;
}

export const advancedAdminCoachingSessions = (id: number, signal?: AbortSignal) =>
  get<{ items: AdvancedAdminCoachingSession[] }>(`learners/${id}/coaching-sessions/`, signal);

export interface AdvancedAdminCoachingSessionDetail {
  id: string;
  learnerName: string | null;
  learnerEmail: string | null;
  programme: string | null;
  group: string | null;
  coachName: string | null;
  managerName: string | null;
  managerEmail: string | null;
  family: 'pr' | 'mcm';
  plannedDate: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  status: string | null;
  meetingId: string | null;
  learnerAttended: boolean | null;
  managerAttended: boolean | string | null;
  transcript: { content: string | null; status: string; durationSeconds: number | null } | null;
  attendance: {
    status: string;
    participantCount: number | null;
    startAt: string | null;
    endAt: string | null;
    learner: { attended: boolean; durationSeconds: number | null; intervals: unknown } | null;
    manager: { attended: boolean; durationSeconds: number | null; intervals: unknown } | null;
  } | null;
  aiStatus: string | null;
  report: Record<string, unknown> | null;
}

export const advancedAdminCoachingSessionDetail = (learnerId: number, sessionId: string, signal?: AbortSignal) =>
  get<AdvancedAdminCoachingSessionDetail>(`learners/${learnerId}/coaching-sessions/${encodeURIComponent(sessionId)}/`, signal);

export interface AdvancedAdminQuality {
  source: 'tutor' | 'lecture';
  sessionId: string;
  date: string;
  subject: string;
  trainer: string;
  rating: number | null;
  comments: string | null;
  judgement: string | null;
  module: string | null;
  durationScore?: number | null;
  engagementScore?: number | null;
  metCount?: number | null;
  partialCount?: number | null;
  notMetCount?: number | null;
  duration?: string | null;
  learnersEnrolled?: number | null;
  learnersAttended?: number | null;
  observationState?: string | null;
  checklist?: { order: number; item: string; status: string; evidence: string | null }[];
  strengths?: unknown;
  areasForDevelopment?: unknown;
  ksbCoverage?: unknown;
}

export interface AdvancedAdminReview {
  id: string;
  componentId?: number;
  aptemReviewId: string;
  name: string;
  type: string;
  status: string;
  plannedDate: string | null;
  completedDate: string | null;
  sections: { id: string | number; name: string; fields: { label: string; value: unknown }[] }[];
  aiCoachingReport: Record<string, unknown> | null;
  coachName?: string | null;
  managerName?: string | null;
  learnerName?: string | null;
  learnerEmail?: string | null;
  programme?: string | null;
  group?: string | null;
  signatures?: Record<'coach' | 'student' | 'manager', {
    required: boolean;
    signed: boolean | null;
    signedAt: string | null;
  }>;
}

export const advancedAdminQuality = (id: number, signal?: AbortSignal) =>
  get<{ tutor: AdvancedAdminQuality[]; lecture: AdvancedAdminQuality[] }>(`learners/${id}/quality/`, signal);

export const advancedAdminReviews = (id: number, signal?: AbortSignal) =>
  get<{ pr: AdvancedAdminReview[]; mcm: AdvancedAdminReview[] }>(`learners/${id}/reviews/`, signal);

export const advancedAdminCoachingReviews = (id: number, signal?: AbortSignal) =>
  get<{ pr: AdvancedAdminReview[]; mcm: AdvancedAdminReview[]; documentLookupError?: string }>(`learners/${id}/coaching-reviews/`, signal);

export interface AdvancedAdminEligibility {
  eventKey: string;
  label: string;
  date: string | null;
  status: string;
  answers: Record<string, unknown>;
  sectionStatus: Record<string, boolean>;
  completed: boolean;
}

export const advancedAdminEligibility = (id: number, signal?: AbortSignal) =>
  get<{ native: AdvancedAdminEligibility[]; imported: AdvancedAdminReview[] }>(`learners/${id}/eligibility/`, signal);

export const advancedAdminEligibilityForm = (id: number, eventKey: string, signal?: AbortSignal) =>
  get<ReviewFormResponse>(`learners/${id}/eligibility/${encodeURIComponent(eventKey)}/form/`, signal);

export const advancedAdminReviewPdf = (id: number, reviewId: string) =>
  `/login_api/advanced-admin/learners/${id}/reviews/${encodeURIComponent(reviewId)}/pdf/`;

export const advancedAdminOriginalReviewPdf = (id: number, reviewId: string) =>
  `/login_api/advanced-admin/learners/${id}/reviews/${encodeURIComponent(reviewId)}/original-pdf/`;

export const advancedAdminReviewPdfSignatures = (id: number, reviewId: string, signal?: AbortSignal) =>
  get<{ signatures: Record<'coach' | 'student' | 'manager', boolean | null> }>(
    `learners/${id}/reviews/${encodeURIComponent(reviewId)}/pdf-signatures/`, signal);

export async function advancedAdminMark(id: number, submissionId: string, decision: string, feedback: string) {
  const { csrfToken } = await get<{ csrfToken: string }>('csrf/');
  const response = await fetch(`/login_api/advanced-admin/learners/${id}/submissions/${submissionId}/`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ decision, feedback }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'Could not save marking decision.');
  return payload as { id: string; status: string };
}
