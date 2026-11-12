export type CheckStatus = "Pending" | "Approved" | "Rejected" | "Needs Correction" | "In Review";

export type CriterionState = "Pass" | "Fail" | "Needs Improvement" | "Not Checked";

export type FormStatus = "Completed" | "Draft";

export type AuditEntry = {
  id: string;
  action: string;
  reviewer: string;
  date: string;
  comment?: string;
};

export type Review = {
  id: string;
  learner: string;
  learnerId: string;
  coach: string;
  formType: string;
  programme: string;
  cohort: string;
  module: string;
  meetingDate: string;
  submissionDate: string;
  savedBy: string;
  version: string;
  formStatus: FormStatus;
  formCheck: CheckStatus;
  feedbackCheck: CheckStatus;
  followUps: number;
  formsChecks: CriterionState[];
  feedbackChecks: CriterionState[];
  feedbackSummary: string;
  comments: string;
  reviewer: string;
  decidedAt: string;
  audit: AuditEntry[];
};

export type Filters = {
  learner: string;
  coach: string;
  formType: string;
  programme: string;
  cohort: string;
  dateRange: string;
  formStatus: string;
  formCheck: string;
  feedbackCheck: string;
  rag: string;
};

export type SortKey = "learner" | "coach" | "formType" | "meetingDate" | "formCheck" | "feedbackCheck" | "version" | "followUps";

export type SortState = { key: SortKey; dir: "asc" | "desc" };

export type Criterion = { id: string; label: string };

export type RagLevel = "Green" | "Amber" | "Red";

export type RagSlice = { red: number; amber: number; green: number };

export type ProgrammeRag = {
  programme: string;
  cohort: string;
  red: number;
  amber: number;
  green: number;
};

export type RagPeriod = {
  key: string;
  label: string;
  totalChecks: number;
  overall: RagSlice;
  forms: RagSlice;
  feedback: RagSlice;
  timeliness: RagSlice;
  byProgramme: ProgrammeRag[];
};

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  email: string;
  reviews: number;
  approvalRate: number;
  reworkRate: number;
  turnaround: string;
  rag: RagLevel;
  caseload: number;
  capacity: number;
  focus: string;
};

export type FeedbackSource = "Learner" | "Employer";

export type FeedbackStatus = "New" | "Acknowledged" | "Escalated";

export type Feedback = {
  id: string;
  source: FeedbackSource;
  author: string;
  organisation: string;
  programme: string;
  coach: string;
  date: string;
  rating: number;
  rag: RagLevel;
  status: FeedbackStatus;
  topic: string;
  comment: string;
};

export type SessionStatus = "Scheduled" | "Awaiting check" | "In review" | "Approved" | "Needs correction" | "Rejected";

export type SessionMode = "In person" | "Online" | "Workplace";

export type SessionFile = {
  name: string;
  size: string;
  kind: "pdf" | "doc" | "image";
};

export type CoachSession = {
  id: string;
  coach: string;
  coachRole: string;
  learner: string;
  learnerId: string;
  programme: string;
  cohort: string;
  module: string;
  formType: string;
  date: string;
  start: string;
  duration: number;
  mode: SessionMode;
  location: string;
  summary: string;
  submittedAt: string;
  version: string;
  status: SessionStatus;
  files: SessionFile[];
  criteria: CriterionState[];
  comment: string;
  decidedAt: string;
};

/* ------------------------------------------------------------------ *
 * Quality registry & RAG evaluation
 * ------------------------------------------------------------------ */

/** Every possible quality outcome. Colour alone is never the only signal. */
export type QualityStatus = "Green" | "Amber" | "Red" | "Not assessed" | "Not applicable";

export type FormCategoryId = "coaching" | "teaching" | "compliance" | "progression" | "onboarding" | "legacy";

export type FormCategory = {
  id: FormCategoryId;
  label: string;
  description: string;
};

/** A single approved evaluation policy. One policy per form type — never shared by default. */
export type RagPolicy = {
  id: string;
  version: string;
  method: "criteria" | "unrated";
  summary: string;
  /** 1-based criterion positions that force Red when failed. */
  criticalCriteria: number[];
  redAtFails: number;
  amberAtIssues: number;
  requireFullReview: boolean;
};

export type FormRegistryEntry = {
  id: string;
  name: string;
  category: FormCategoryId;
  version: string;
  source: string;
  owner: string;
  respondent: string;
  subject: string;
  answerTypes: string[];
  policyId: string;
  metrics: string[];
  actionsAllowed: boolean;
  access: string[];
};

export type RagResult = {
  status: QualityStatus;
  label: string;
  reason: string;
  policyId: string;
  policyVersion: string;
};
