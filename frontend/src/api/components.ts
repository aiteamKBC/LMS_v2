// ============================================================================
// Generic component-completion API client.
// Records that a learner finished a non-quiz, non-video component (podcast,
// reading, slide deck, reflection, activity, …) + their post-completion
// reflection. POSTs to /learner_api/components/<componentId>/complete/.
// ============================================================================

const BASE = '/learner_api/components';

export interface ComponentProgressSubmission {
  week?: string | null;
  module?: string | null;
  startedAt: string;
  timeTakenSeconds: number;
  componentTitle?: string | null;
  componentType?: string | null;
  ksbs?: string[];
  feedback?: string;
  reportedTime?: string;
}

export interface ComponentProgressRecord {
  kind: 'component';
  componentType: string;
  componentId: string;
  attempt: number;
  ksbs: string[];
  feedback: string;
  reportedTime: string;
  startedAt: string | null;
  submittedAt: string;
  timeTaken: string | null;
}

export interface ComponentProgressResponse {
  record: ComponentProgressRecord;
  componentTitle: string;
  componentType: string;
  week: string | null;
  module: string | null;
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
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Record a completed component + reflection for a learner. */
export function submitComponentProgress(
  componentId: string,
  kind: 'commercial' | 'apprenticeship',
  learnerId: string,
  submission: ComponentProgressSubmission,
): Promise<ComponentProgressResponse> {
  return request<ComponentProgressResponse>(
    `${BASE}/${encodeURIComponent(componentId)}/complete/?kind=${kind}&learnerId=${learnerId}`,
    { method: 'POST', body: JSON.stringify(submission) },
  );
}
