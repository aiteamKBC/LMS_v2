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
  month?: string;
  week_start?: string | null;
  week_end?: string | null;
  position?: number;
  has_result?: boolean;
  best_score_percent?: number | null;
  historical_completed?: boolean;
  new_attempt_count?: number;
}

export interface StudentActivityResponse {
  learner_name: string;
  count: number;
  unique_activity_count: number;
  module_count: number;
  completed_count: number;
  actual_total: number | null;
  planned_total: number | null;
  mapped_count: number;
  planned_mapped_count: number;
  activities: StudentActivityItem[];
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

export interface SubjectMaterial {
  title: string;
  reading_html: string;
  media: { kind: string; url: string; title: string; can_embed?: boolean }[];
  quiz: SubjectQuiz | null;
  has_reading: boolean;
  available: boolean;
  source_live: boolean;
  unavailable_attachments?: string[];
  persistence_ready: boolean;
  can_attempt: boolean;
  csrf_token: string;
  history: { id: string; score_percent: number | null; passed: boolean | null; completed: boolean;
    submitted_at: string; answers: Record<string, string[]>;
    answer_review?: { question: string; selected: string[]; correct: boolean }[] }[];
  historical: { score: number | null; maximum_score: number | null; passed: boolean | null;
    attempt_number: number | null; status: string | null;
    answers: { question_id: number; question_body: string; learner_answer: unknown; is_correct: boolean }[] };
}

export async function subjectRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  if (body == null) throw new Error('The server returned an invalid response.');
  return body as T;
}

export async function fetchStudentActivity(kind: LearnerKind, learnerId: string, signal?: AbortSignal): Promise<StudentActivityResponse> {
  let response: Response;
  try {
    response = await fetch(`/learner_api/student-activity/${kind}/${learnerId}/`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    throw new Error('Could not reach the server.');
  }

  const payload = await response.json().catch(() => null) as (StudentActivityResponse & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  if (!payload || !Array.isArray(payload.activities)) throw new Error('Received an invalid student activity response.');
  return payload;
}
