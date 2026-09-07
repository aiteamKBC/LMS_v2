import type { LearnerKind } from './learnerDetail';

export interface StudentActivityItem {
  activity_id: string;
  group_id: number;
  group_name: string | null;
  date: string | null;
  category: string;
  activity: string;
  status: string | null;
  completed: boolean;
  actual: number;
  hours_mapped: boolean;
  quiz_score: number | null;
  quiz_maximum_score: number | null;
}

export interface StudentActivityResponse {
  learner_name: string;
  count: number;
  module_count: number;
  completed_count: number;
  activities: StudentActivityItem[];
}

export async function fetchStudentActivity(kind: LearnerKind, learnerId: string): Promise<StudentActivityResponse> {
  let response: Response;
  try {
    response = await fetch(`/learner_api/student-activity/${kind}/${learnerId}/`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Could not reach the server.');
  }

  const payload = await response.json().catch(() => null) as (StudentActivityResponse & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  if (!payload || !Array.isArray(payload.activities)) throw new Error('Received an invalid student activity response.');
  return payload;
}
