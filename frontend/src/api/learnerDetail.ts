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
  isQuiz?: boolean;
  quizMeta?: { quizId: number; questions: number | null; duration: number | null; timeUnit: string | null };
}
export interface LearnerKsbItem {
  code: string;
  type: string;
  number: string;
  description: string;
}

export interface LearnerQuizQuestionResult {
  questionId: number;
  questionText: string;
  type: string;
  points: number;
  earned: number;
  possible: number;
  correct: boolean;
  chosenAnswer: string | null;
  correctAnswer: string | null;
}

export interface LearnerQuizAttempt {
  week: string | null;
  attempt?: number;           // 1-based attempt number for this quiz
  grade: string;              // e.g. "30%"
  Score?: string;             // questions correct / total, e.g. "6/20"
  module: string | null;
  passed: boolean;
  quizId: number;
  quizName: string;
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
  totalExpectedOtjh: number;
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
