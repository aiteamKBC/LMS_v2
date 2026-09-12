import { readLearnerJson, peekLearnerJson, invalidateLearnerReads } from './learnerRead';
import type { LearnerKind } from './learnerDetail';

export interface StudentActivityItem {
  activity_id: string;
  source_activity_id: number;
  group_id: number;
  group_name: string | null;
  date: string | null;
  category: string;
  activity: string;
  status: string | null;
  completed: boolean;
  actual: number;
  planned: number;
  planned_hours_mapped: boolean;
  hours_mapped: boolean;
  quiz_score: number | null;
  quiz_maximum_score: number | null;
  source_date?: string | null;
  date_source?: string;
  date_needs_review?: boolean;
  section_title?: string;
  month?: string;
  week_start?: string | null;
  week_end?: string | null;
  position?: number;
  has_result?: boolean;
  best_score_percent?: number | null;
  historical_completed?: boolean;
  new_attempt_count?: number;
}

export interface DirectOtjhActivity {
  kind: string;
  componentId?: string | null;
  quizId?: string | number | null;
  componentTitle?: string | null;
  componentType?: string | null;
  moduleTitle?: string | null;
  weekTitle?: string | null;
  reportedTime?: string | null;
  claimedSeconds?: number | null;
  verifiedSeconds?: number | null;
  timeTrackingSource?: string | null;
  expectedOtjh?: number | null;
  submittedAt?: string | null;
  passed?: boolean | null;
}

export interface StudentActivityResponse {
  learner_name: string;
  count: number;
  unique_activity_count: number;
  module_count: number;
  completed_count: number;
  actual_total: number | null;
  /** Historical subject time plus later direct-platform OTJH, across every
   * subject represented in the learner's combined workspace. */
  recorded_otjh_total?: number | null;
  /** Whole-programme figures from the same sources as Audit learner search. */
  audit_tp_planned?: number | null;
  audit_lms_actual?: number | null;
  /** Distinct KSB codes evidenced in the audit mapping. A count, not a
   *  percentage: the mapping spans several standards, so it carries no
   *  per-learner denominator to divide by. */
  audit_ksb_evidenced?: number | null;
  direct_otjh_activities?: DirectOtjhActivity[];
  planned_total: number | null;
  mapped_count: number;
  planned_mapped_count: number;
  activities: StudentActivityItem[];
  source_status?: 'live' | 'historical';
  activity_sources?: Record<string, { module_id: string; group_id: number; activity_id: number }>;
  subjects?: { id: number; name: string }[];
  covers?: Record<string, string>;
  persistence_ready?: boolean;
  can_manage_covers?: boolean;
}

export interface SubjectQuiz {
  id: string;
  body: string;
  ready: boolean;
  message: string;
  passing_percent: number | null;
  questions: { id: string; text: string; type: string; options: { id: string; text: string }[] }[];
}

export interface SubjectAttemptResult {
  score_percent: number | null;
  passed: boolean | null;
  completed: boolean;
}

export interface SubjectMaterial {
  title: string;
  reading_html: string;
  media: { kind: string; url: string; title: string; can_embed?: boolean; file_name?: string }[];
  quiz: SubjectQuiz | null;
  has_reading: boolean;
  available: boolean;
  source_live: boolean;
  unavailable_attachments?: string[];
  persistence_ready: boolean;
  can_attempt: boolean;
  completed?: boolean;
  csrf_token: string;
  history: { id: string; score_percent: number | null; passed: boolean | null; completed: boolean;
    submitted_at: string; answers: Record<string, string[]>;
    answer_review?: { question: string; selected: string[]; correct: boolean }[] }[];
  historical: { score: number | null; maximum_score: number | null; passed: boolean | null;
    attempt_number: number | null; status: string | null;
    answers: { question_id: number; question_body: string; learner_answer: unknown; is_correct: boolean }[] };
}

export async function subjectRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  if (!options.method || options.method.toUpperCase() === 'GET') {
    const cacheable = url.includes('/subject-covers/');
    return readLearnerJson<T>(url, { ...options, ttlMs: cacheable ? 30_000 : 0 });
  }
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  if (body == null) throw new Error('The server returned an invalid response.');
  invalidateLearnerReads();
  return body as T;
}

export async function fetchStudentActivity(kind: LearnerKind, learnerId: string, signal?: AbortSignal): Promise<StudentActivityResponse> {
  const payload = await readLearnerJson<StudentActivityResponse>(
    `/learner_api/student-activity/${kind}/${learnerId}/`,
    { signal, headers: { Accept: 'application/json' }, ttlMs: 30_000 },
  );
  if (!Array.isArray(payload.activities)) {
    invalidateLearnerReads();
    throw new Error('Received an invalid student activity response.');
  }
  return payload;
}

export function peekStudentActivity(kind: LearnerKind, learnerId: string): StudentActivityResponse | undefined {
  return peekLearnerJson(`/learner_api/student-activity/${kind}/${learnerId}/`, { headers: { Accept: 'application/json' } });
}
