// ============================================================================
// Employer portal API client
//
// The employer-facing view of their own learners: who they are, what each
// learner's progress looks like, and which documents still need the employer's
// signature.
//
// Signing reuses the existing endpoints rather than adding parallel ones:
//  - reviews  -> /learner_api/reviews/<kind>/<id>/<eventKey>/sign/ with
//                party="employer", the same call the learner and admin sides make
//  - PDFs     -> /enrolment_api/documents/<kind>/<id>/<docId>/sign/
// ============================================================================

import type { LearnerDetail } from '@/api/learnerDetail';

const BASE = '/learner_api/employer-portal';

export interface EmployerLearnerCard {
  id: string;
  kind: 'apprenticeship' | 'commercial';
  name: string;
  email: string;
  programme: string;
  cohort: string;
  programmeStatus: string;
  onboardingStatus: string;
  /** On programme — their card leads with performance rather than paperwork. */
  isActive: boolean;
  /** Documents this employer can sign right now but hasn't. */
  outstandingCount: number;
  documentsTotal: number;
}

/** A review awaiting (or carrying) the employer's signature. */
export interface EmployerReviewRow {
  kind: 'review';
  eventKey: string;
  reviewType: string;
  label: string;
  scheduledDate: string;
  /** False until the questionnaire itself is finished — nobody can sign before. */
  signable: boolean;
  completed: boolean;
  sectionsTotal: number;
  employerSignatureRequired: boolean;
  signed: boolean;
  signedName: string;
  signedAt: string | null;
  learnerSigned: boolean;
  adminSigned: boolean;
}

/** A generated compliance PDF awaiting (or carrying) the employer's signature. */
export interface EmployerDocumentRow {
  /**
   * 'agreement' is the Apprenticeship Agreement, which has its own table and
   * signing endpoint but appears in the same signable list as everything else.
   */
  kind: 'document' | 'agreement' | 'training-plan' | 'written-agreement';
  id: string;
  docType: string;
  label: string;
  generatedAt: string | null;
  /** False for documents this type doesn't ask the employer to sign. */
  signable: boolean;
  signed: boolean;
  signedName: string;
  signedAt: string | null;
  /** Every party this document needs, e.g. ['learner', 'employer']. */
  parties?: string[];
  /** The learner's side, so the employer can see who else has signed. */
  learnerSigned?: boolean;
  learnerSignedName?: string;
  learnerSignedAt?: string | null;
  /** The provider's side, on tripartite documents like the Training Plan. */
  providerSigned?: boolean;
  providerSignedName?: string;
  providerSignedAt?: string | null;
}

export type SignableItem = EmployerReviewRow | EmployerDocumentRow;

export interface EmployerPortal {
  employer: {
    id: string;
    name: string;
    email: string;
    employerGroupNames: string[];
  };
  learners: EmployerLearnerCard[];
  outstandingTotal: number;
}

export interface EmployerPerformance {
  quizzesTaken: number;
  quizzesPassed: number;
  averageScore: number | null;
  componentsCompleted: number;
  ksbsEvidenced: number;
  completedHours: string | null;
  lastActivityAt: string | null;
}

export interface EmployerLearnerDetail {
  employer: { id: string; name: string };
  learner: {
    id: string;
    kind: 'apprenticeship' | 'commercial';
    name: string;
    email: string;
    phone: string;
    programme: string;
    cohort: string;
    programmeStatus: string;
    onboardingStatus: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
  };
  performance: EmployerPerformance;
  reviews: EmployerReviewRow[];
  documents: EmployerDocumentRow[];
  outstandingCount: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      // The portal endpoints are gated on the session (employer_or_staff): an
      // employer may read only their own record, staff may read any. Without
      // this the HttpOnly kbc_session cookie is not sent and every call 401s.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
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

export function fetchEmployerPortal(employerId: string): Promise<EmployerPortal> {
  return request<EmployerPortal>(`${BASE}/${employerId}/`);
}

export function fetchEmployerLearner(
  employerId: string,
  kind: string,
  learnerId: string,
): Promise<EmployerLearnerDetail> {
  return request<EmployerLearnerDetail>(`${BASE}/${employerId}/learner/${kind}/${learnerId}/`);
}

/**
 * The learner's own training plan, hours and KSBs.
 *
 * Deliberately the same payload the learner's workspace reads (LearnerDetail),
 * so the employer sees the identical weeks, components and KSB mappings instead
 * of a second summary that could drift. The employer UI renders it read-only.
 */
export function fetchEmployerLearnerPlan(
  employerId: string,
  kind: string,
  learnerId: string,
): Promise<LearnerDetail> {
  return request<LearnerDetail>(`${BASE}/${employerId}/learner/${kind}/${learnerId}/plan/`);
}


/**
 * Sign a review as the employer — the same endpoint the learner and admin use,
 * with party="employer". An empty signature withdraws the sign-off.
 */
export function signReviewAsEmployer(
  kind: string,
  learnerId: string,
  eventKey: string,
  input: { name: string; signature: string },
): Promise<unknown> {
  return request(
    `/learner_api/reviews/${kind}/${learnerId}/${encodeURIComponent(eventKey)}/sign/`,
    { method: 'POST', body: JSON.stringify({ party: 'employer', ...input }) },
  );
}

/** Sign a generated compliance PDF. An empty signature withdraws the sign-off. */
export function signDocumentAsEmployer(
  kind: string,
  learnerId: string,
  docId: string,
  input: { name: string; signature: string },
): Promise<unknown> {
  return request(
    `/enrolment_api/documents/${kind}/${learnerId}/${docId}/sign/`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/**
 * The Apprenticeship Agreement has its own table and signing endpoint, so it
 * does not go through the generic document route above.
 */
export function signAgreementAsEmployer(
  learnerId: string,
  input: { name: string; signature: string },
): Promise<unknown> {
  return request(
    `/learner_api/apprenticeship-agreement/${learnerId}/sign/`,
    { method: 'POST', body: JSON.stringify({ ...input, party: 'employer' }) },
  );
}

/** The Training Plan is tripartite and has its own signing endpoint. */
export function signTrainingPlanAsEmployer(
  learnerId: string,
  input: { name: string; signature: string },
): Promise<unknown> {
  return request(
    `/learner_api/training-plan-document/${learnerId}/sign/`,
    { method: 'POST', body: JSON.stringify({ ...input, party: 'employer' }) },
  );
}

/** The Written Agreement is tripartite and has its own signing endpoint. */
export function signWrittenAgreementAsEmployer(
  learnerId: string,
  input: { name: string; signature: string },
): Promise<unknown> {
  return request(
    `/learner_api/written-agreement/${learnerId}/sign/`,
    { method: 'POST', body: JSON.stringify({ ...input, party: 'employer' }) },
  );
}
