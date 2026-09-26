import { fetchLearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerMetrics } from '@/api/learnerMetrics';
import { fetchStudentActivity } from '@/api/studentActivity';
import { coachFetch } from '@/lib/coachFetch';
import type { LearnerKind } from '@/api/learnerDetail';

export interface CaseFileShell {
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

// React StrictMode intentionally re-runs effects in development. Sharing an
// in-flight GET prevents that check from doubling slow database work.
const pendingRequests = new Map<string, Promise<unknown>>();

async function request<T>(url: string): Promise<T> {
  const existingRequest = pendingRequests.get(url) as Promise<T> | undefined;
  if (existingRequest) return existingRequest;

  const pendingRequest = requestUncached<T>(url);
  pendingRequests.set(url, pendingRequest);
  try {
    return await pendingRequest;
  } finally {
    pendingRequests.delete(url);
  }
}

async function requestUncached<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await coachFetch(url, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(`Backend returned HTML instead of JSON (${res.status}). Check the Django server error output.`);
      }
      throw new Error('Received an invalid JSON response from the backend.');
    }
  }

  if (!res.ok) {
    const message = typeof data === 'object' && data && ('error' in data || 'detail' in data)
      ? String((data as { error?: string; detail?: string }).error || (data as { detail?: string }).detail)
      : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export function fetchCaseFileShell(learnerId: string) {
  return request<CaseFileShell>(`/coach_api/coach/learners/${encodeURIComponent(learnerId)}/case-file`);
}

export const fetchCaseFileLearnerDetail = fetchLearnerDetail;
export const fetchCaseFileLearnerMetrics = fetchLearnerMetrics;
export const fetchCaseFileStudentActivity = fetchStudentActivity;
