import { fetchLearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerMetrics } from '@/api/learnerMetrics';
import { fetchStudentActivity } from '@/api/studentActivity';
import { coachFetch } from '@/lib/coachFetch';
import type { LearnerKind } from '@/api/learnerDetail';

export interface LearnerProfileShell {
  identity: {
    learnerId: string;
    enrolmentId: string | null;
    aptemId: string | null;
    kind: LearnerKind;
    source: 'aptem' | 'native' | 'conflict';
    identityConflict: boolean;
  };
  profile: {
    name: string | null;
    email: string | null;
    programme: string | null;
    cohort: string | null;
    group: string | null;
    employer: string | null;
    coachName: string | null;
    coachEmail: string | null;
    status: string | null;
    startDate: string | null;
    plannedEndDate: string | null;
    gatewayReviewDate: string | null;
    coachRag: string | null;
  };
}

// StrictMode may replay an effect. Coalesce only identical in-flight shell reads;
// settled reads remain retryable and no response is cached between learners.
const pendingShellRequests = new Map<string, Promise<unknown>>();

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await coachFetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(response.ok
        ? 'Received an invalid JSON response from the backend.'
        : `Backend returned HTML instead of JSON (${response.status}). Check the Django server error output.`);
    }
  }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as { error?: string; detail?: string } : {};
    throw new Error(record.error || record.detail || `Request failed (${response.status})`);
  }
  return payload as T;
}

export function fetchLearnerProfileShell(learnerId: string) {
  const url = `/coach_api/coach/learners/${encodeURIComponent(learnerId)}/case-file`;
  const existing = pendingShellRequests.get(url) as Promise<LearnerProfileShell> | undefined;
  if (existing) return existing;
  const request = readJson<LearnerProfileShell>(url);
  pendingShellRequests.set(url, request);
  void request.finally(() => pendingShellRequests.delete(url));
  return request;
}

export const fetchLearnerProfileDetail = fetchLearnerDetail;
export const fetchLearnerProfileMetrics = (kind: LearnerKind, id: string, signal?: AbortSignal, force = false) =>
  fetchLearnerMetrics(kind, id, signal, force, 'learner-overview');
export const fetchLearnerProfileActivity = fetchStudentActivity;

