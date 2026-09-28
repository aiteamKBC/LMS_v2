// ============================================================================
// Coach case file — Enrolment Documents
// The learner's enrolment review documents, which the coach views, downloads
// and signs (college sign-off) with their saved signature. The server only
// answers for a learner on the signed-in coach's caseload
// (backend/coach_api/enrolment_documents.py).
// ============================================================================
import { coachFetch } from '@/lib/coachFetch';
import type { ReviewDocument, ReviewFormResponse } from '@/api/reviewForm';

export interface CoachEnrolmentDocumentsResponse {
  documents: ReviewDocument[];
  /** Whether the coach has a saved signature to sign with. */
  signature: { saved: boolean; name: string };
}

async function send<T>(url: string, init?: globalThis.RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await coachFetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  } catch {
    throw new Error('Could not reach the server.');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    const body = data as { error?: string; detail?: string } | null;
    throw new Error(body?.error || body?.detail || `Request failed with ${res.status}`);
  }
  return data as T;
}

const base = (learnerId: string) => `/coach_api/coach/learners/${encodeURIComponent(learnerId)}/enrolment-documents`;

export function fetchCoachEnrolmentDocuments(learnerId: string): Promise<CoachEnrolmentDocumentsResponse> {
  return send(base(learnerId));
}

export function fetchCoachEnrolmentDocument(learnerId: string, eventKey: string): Promise<ReviewFormResponse> {
  return send(`${base(learnerId)}/${encodeURIComponent(eventKey)}`);
}

/** Sign the college sign-off with the coach's saved signature. */
export function signCoachEnrolmentDocument(learnerId: string, eventKey: string): Promise<ReviewFormResponse> {
  return send(`${base(learnerId)}/${encodeURIComponent(eventKey)}/sign`, { method: 'POST', body: '{}' });
}
