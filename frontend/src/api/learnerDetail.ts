// ============================================================================
// Learner-detail API client.
// Talks to the Django backend at /learner_api (proxied to :8000 by Vite in dev).
// Combines a CommercialUser/EnrolmentUser row with its "Learner"."Active_users"
// mirror (present only while the learner is Active) into one read-only shape.
// ============================================================================

const BASE = '/learner_api/learner-detail';

export type LearnerKind = 'commercial' | 'apprenticeship';

export interface LearnerWeekEntry {
  module: string | null;
  week: string;
}
export interface LearnerComponentEntry {
  module: string | null;
  week: string | null;
  component: string;
  expectedOtjh: number | null;
  componentId?: string | null;
  type?: string | null;                 // master component type, e.g. 'video', 'live_session'
  description?: string | null;
  videoUrl?: string | null;             // present on video components authored with a URL
  durationMinutes?: number | null;
  isQuiz?: boolean;
  quizMeta?: { quizId: number; questions: number | null; duration: number | null; timeUnit: string | null };
}
export interface LearnerKsbItem {
  code: string;
  type: string;
  number: string;
  description: string;
}

// Slim stored per-question result — references answers by id (resolved to text
// on display via the fetched quiz). Free-text types (fill_gap/keywords/matching)
// have no answer id, so they carry chosenText instead.
export interface LearnerQuizQuestionResult {
  questionId: number;
  earned: number;
  correct: boolean;
  chosenAnswerId?: number | number[] | null;
  correctAnswerId?: number[] | null;
  chosenText?: string | null;   // free-text answer types only
}

export interface LearnerQuizAttempt {
  kind?: 'quiz';
  attempt?: number;           // 1-based attempt number for this quiz
  grade: number;              // 0-1 decimal, e.g. 0.9
  achievedScore?: number;     // questions correct
  totalScore?: number;        // questions total
  passed: boolean;
  quizId: number;
  ksbs?: string[];            // KSB codes the learner marked fulfilled
  feedback?: string;
  reportedTime?: string;      // learner's chosen time (planned label or free text)
  questions?: LearnerQuizQuestionResult[];
  startedAt: string;
  submittedAt: string;
  timeTaken?: string;         // "MM:SS", e.g. "00:26" (auto-tracked)
}

export interface LearnerDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  programme: string;
  programmeStatus: string;
  cohort: string;
  group: string;
  employer: string;
  isActive: boolean;
  modules: string[];
  week: LearnerWeekEntry[];
  components: LearnerComponentEntry[];
  ksbs: LearnerKsbItem[];
  quizAttempts: LearnerQuizAttempt[];
  videoProgress?: LearnerVideoProgress[];
  activityFeed?: LearnerActivityEntry[];   // newest first
  totalExpectedOtjh: number;
  plannedHours?: string;      // planned OTJ hours (also stored in Active_users.planned_hours)
  completedHours?: string;    // completed OTJ hours, all activities (Active_users.Completed_hours)
  targetHours?: string;       // cumulative planned hours up to the current week (Target_hours)
  progressHours?: string;     // completed - target (Progress_Hours)
  progressVariance?: string;  // (completed - target) / target, decimal (Progress_variance); '' if target=0
  otjhStatus?: string;        // "On track" | "Need attention" | "At risk" (OTJHoursStatus)
}

export interface LearnerActivityEntry {
  kind: 'quiz' | 'video';
  action: string;             // e.g. "Completed quiz", "Watched video"
  title: string;
  detail?: string;            // e.g. "Scored 90% · 18/20"
  passed?: boolean;
  quizId?: number;
  componentId?: string;
  week?: string | null;
  module?: string | null;
  at: string;                 // ISO timestamp
}

export interface LearnerVideoProgress {
  kind: 'video';
  componentId: string;
  attempt?: number;
  ksbs?: string[];
  feedback?: string;
  reportedTime?: string;
  startedAt: string | null;
  submittedAt: string;
  timeTaken: string | null;
}

async function request<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Fetch a single learner's detail (identity + programme + Active_users snapshot). */
export function fetchLearnerDetail(kind: LearnerKind, id: string): Promise<LearnerDetail> {
  return request<LearnerDetail>(`${BASE}/${kind}/${id}/`);
}
