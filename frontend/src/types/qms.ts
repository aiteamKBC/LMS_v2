export type RagStatus = "green" | "amber" | "red" | "unrated" | "na";
export type QualityRating = "gold" | "green" | "amber" | "red" | "na";
export type FeedbackClassification = "positive" | "neutral" | "negative" | "unscored";

export interface QualityRatingCounts {
  gold: number;
  green: number;
  amber: number;
  red: number;
  na: number;
}

export type FormCategory =
  | "Quality Audit"
  | "Learner Feedback"
  | "Employer Feedback"
  | "Tutor Review"
  | "Service Feedback";

export type SubjectType =
  | "Coach"
  | "Tutor"
  | "Learner"
  | "Employer"
  | "Programme"
  | "College"
  | "Service"
  | "Teaching & Learning";

export type RespondentType = "Quality Auditor" | "Learner" | "Employer" | "Tutor" | "Coach";

export interface RagCounts {
  green: number;
  amber: number;
  red: number;
  unrated: number;
  na: number;
  total: number;
}

export interface FormDefinition {
  id: string;
  feedbackType?: string | null;
  name: string;
  shortName: string;
  category: FormCategory;
  version: string;
  sourceTable: string;
  owner: string;
  respondentType: RespondentType;
  subjectType: SubjectType;
  questionCount: number;
  answerTypes: string[];
  scoringMethod: string;
  policyId: string | null;
  policyVersion: string | null;
  policySummary: string;
  requiresAction: boolean;
  access: string;
  scheduled: number;
  submissions: number;
  latest: string | null;
  rag: RagCounts;
  completionRate: number | null;
  ragSupported: boolean;
}

export interface QualityRecord {
  id: string;
  formId: string;
  formName: string;
  category: FormCategory;
  subjectType: SubjectType;
  subjectName: string;
  coachName?: string | null;
  tutorName?: string | null;
  feedbackType?: string | null;
  department: string;
  programme: string;
  respondentType: RespondentType;
  respondentName: string;
  auditor: string;
  assessedOn: string;
  rag: RagStatus;
  policyVersion: string | null;
  critical: boolean;
  summary: string;
  learnerRef: string | null;
  answeredQuestions: number;
  totalQuestions: number;
  reviewStatus?: "draft" | "completed";
  ratingCounts?: QualityRatingCounts | null;
  feedbackClassification?: FeedbackClassification | null;
}

export interface Coach {
  id: string;
  name: string;
  role: string;
  department: string;
  programme: string;
  learners: number;
}

export type ActionStatus =
  | "Open"
  | "Assigned"
  | "In Progress"
  | "Awaiting Verification"
  | "Resolved"
  | "Closed"
  | "Overdue";

export type ActionPriority = "Critical" | "High" | "Medium" | "Low";

export interface QualityAction {
  id: string;
  ref: string;
  title: string;
  recordId: string;
  formName: string;
  subjectName: string;
  owner: string;
  department: string;
  programme: string;
  priority: ActionPriority;
  status: ActionStatus;
  openedOn: string;
  dueOn: string;
  closedOn: string | null;
  rag: RagStatus;
  detail: string;
  history: { at: string; actor: string; change: string }[];
}

export interface ConcernTheme {
  theme: string;
  category: FormCategory;
  occurrences: number;
  trend: "up" | "down" | "flat";
  example: string;
}

export type PeriodKey =
  | "Last 30 days"
  | "Last 90 days"
  | "Academic year 2026/27"
  | "Last 12 months"
  | "All records";

export interface DashboardFilters {
  period: PeriodKey;
  department: string;
  programme: string;
  category: string;
  formType: string;
  feedbackType: string;
  respondentType: string;
  coach: string;
  tutor: string;
  rag: string;
  query: string;
}

