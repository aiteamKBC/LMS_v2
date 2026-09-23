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
import type { LearnerReviewDefinition } from '@/api/learnerCalendar';

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
  reviewInstanceId?: string;
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

/**
 * A module the learner is on right now (or, when none is live, the nearest one
 * either side of today — `selectionState` says which).
 *
 * `available` is false when the learning plan has no matching subject, in which
 * case the counts stay null rather than collapsing to a misleading zero.
 */
export interface EmployerSummaryModule {
  moduleId: string | null;
  moduleName: string | null;
  progressPercent: number | null;
  completedActivities: number | null;
  totalActivities: number | null;
  currentWeek: number | null;
  totalWeeks: number | null;
  available: boolean;
  source: string;
}

/**
 * The employer's read-only progress summary for one of their learners.
 *
 * Every section carries its own `available` flag because "we could not read
 * this" and "this is genuinely zero" mean different things to an employer.
 * Nulls are preserved end to end; the UI renders them as "Unavailable".
 */
export interface EmployerLearnerSummary {
  learner: {
    id: string;
    kind: 'apprenticeship' | 'commercial';
    name: string;
    email: string;
  };
  programme: {
    name: string;
    status: string;
    cohort: string;
    group: string;
    startDate: string | null;
    plannedEndDate: string | null;
  };
  coach: { id: string | null; name: string | null; email: string | null };
  trainingPlan: { available: boolean; plannedOtjTotalHours: number | null };
  currentLearning: {
    /** Which module(s) the list represents relative to today. */
    selectionState: 'current' | 'multiple' | 'next' | 'last' | 'unavailable';
    modules: EmployerSummaryModule[];
  };
  attendance: {
    available: boolean;
    ratePercent: number | null;
    sessionsHeld: number | null;
    sessionsAttended: number | null;
    absences: number | null;
    /** RAG banding derived from ratePercent, or 'unavailable' when unreadable. */
    classification: 'green' | 'amber' | 'red' | 'unavailable';
    lastSessionDate: string | null;
    lastAttendanceStatus: string | null;
  };
  otj: {
    actualHours: number | null;
    submittedPendingHours: number | null;
    /** The whole-programme target, not a planned-to-date figure. */
    plannedTotalHours: number | null;
    /** Pro-rated across the programme dates; null when those are missing. */
    plannedToDateHours: number | null;
    /** actual − plannedToDate. Negative means behind. Null if either is missing. */
    varianceToDateHours: number | null;
    plannedToDateAvailable: boolean;
    /** True only when the variance is known and negative. */
    behindPlan?: boolean | null;
  };
  ksb: {
    available: boolean;
    metric: string;
    achieved: number | null;
    total: number | null;
    percentage: number | null;
    unit?: string;
    knowledge?: EmployerKsbCategory | null;
    skills?: EmployerKsbCategory | null;
    behaviours?: EmployerKsbCategory | null;
    /** Why the KSB figures are unavailable, when they are. */
    reason?: string | null;
  };
  activity: {
    lastLmsActivityAt: string | null;
    lastSubmissionAt: string | null;
    lastLiveSessionAt: string | null;
  };
  reviews: {
    lastReviewDate: string | null;
    nextReviewDate: string | null;
    pendingEmployerSignatureCount: number | null;
    available: boolean;
  };
  /** Which backend projection each section came from; diagnostic only. */
  sources?: Record<string, string>;
}

export interface EmployerKsbCategory {
  achieved: number | null;
  total: number | null;
  percentage: number | null;
}

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
 * The employer's read-only progress summary for one learner.
 *
 * A narrower projection than the learner plan above: attendance, off-the-job
 * hours, KSB coverage and review dates, each flagged available/unavailable so
 * an unreadable section never reads as a zero.
 */
export function fetchEmployerLearnerSummary(
  employerId: string,
  kind: string,
  learnerId: string,
): Promise<EmployerLearnerSummary> {
  return request<EmployerLearnerSummary>(`${BASE}/${employerId}/learner/${kind}/${learnerId}/summary/`);
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
export function fetchEmployerReviewInstance(
  employerId: string,
  kind: string,
  learnerId: string,
  eventKey: string,
): Promise<LearnerReviewDefinition> {
  return request<LearnerReviewDefinition>(
    `${BASE}/${employerId}/learner/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/review/`,
  );
}

/** Download the signed Progress Review PDF — gated server-side on every required signature. */
export async function downloadEmployerReviewPdf(
  employerId: string,
  kind: string,
  learnerId: string,
  eventKey: string,
): Promise<void> {
  const { saveReviewPdfResponse } = await import('./reviewPdf');
  await saveReviewPdfResponse(await fetch(
    `${BASE}/${employerId}/learner/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/review/pdf/`,
    { credentials: 'include' },
  ));
}

export function signReviewAsEmployer(
  employerId: string,
  kind: string,
  learnerId: string,
  eventKey: string,
  input: { name: string; signature: string },
): Promise<unknown> {
  return request(
    `${BASE}/${employerId}/learner/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/review/`,
    { method: 'POST', body: JSON.stringify(input) },
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
