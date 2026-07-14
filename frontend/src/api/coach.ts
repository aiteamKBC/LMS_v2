// ============================================================================
// Learner coach-contact API client.
// Reads/writes coach_name + coach_email on "Learner"."Active_users" (the mirror).
// Only Active learners have a mirror row, so GET 404s for non-Active learners.
// ============================================================================

const BASE = '/learner_api/learners';

export interface CoachContact {
  coachName: string;
  coachEmail: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

/** Current coach contact for a learner. Throws (status 404) if not Active yet. */
export function fetchLearnerCoach(id: string): Promise<CoachContact> {
  return request<CoachContact>(`${BASE}/${id}/coach/`);
}

/** Update coach contact. Pass only the field(s) you want to change. */
export function updateLearnerCoach(id: string, patch: Partial<CoachContact>): Promise<CoachContact> {
  return request<CoachContact>(`${BASE}/${id}/coach/`, { method: 'PATCH', body: JSON.stringify(patch) });
}
