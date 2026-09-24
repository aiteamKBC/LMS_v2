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

import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import type { OverviewWeek } from '@/api/learnerOverview';
import type { TrainingPlanContract, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { MonthlyLogHours } from '@/features/monthly-logs/api';

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
    /** The learner record's employer display name. */
    employer?: string;
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

/** Whose document a row is, on the all-documents list. */
export interface EmployerDocumentOwner {
  id: string;
  kind: 'apprenticeship' | 'commercial';
  name: string;
  programme: string;
}

export type EmployerOwnedItem = SignableItem & { learner: EmployerDocumentOwner };

export interface EmployerDocuments {
  employer: { id: string; name: string };
  items: EmployerOwnedItem[];
  outstandingTotal: number;
}

/** One file the learner uploaded to an assignment. */
export type EmployerAssignmentFile =
  | { source: 'lms'; id: string; name: string }
  | { source: 'aptem'; id: string; activityId: string; name: string };

/** A handed-in assignment, as the employer sees it: no marks or tutor feedback. */
export interface EmployerAssignment {
  id: string;
  source: 'lms' | 'aptem';
  title: string;
  moduleTitle: string;
  weekTitle: string;
  status: string;
  submittedAt: string | null;
  files: EmployerAssignmentFile[];
}

/** Every assignment this learner has handed in, current and legacy. */
export function fetchEmployerLearnerAssignments(employerId: string, kind: string, learnerId: string) {
  return request<{ assignments: EmployerAssignment[] }>(`${BASE}/${employerId}/learner/${kind}/${learnerId}/assignments/`);
}

/** A short-lived link to one uploaded assignment file. */
export async function fetchEmployerAssignmentFileUrl(employerId: string, kind: string, learnerId: string, file: EmployerAssignmentFile) {
  const base = `${BASE}/${employerId}/learner/${kind}/${learnerId}/assignments`;
  const url = file.source === 'lms'
    ? `${base}/files/${encodeURIComponent(file.id)}/`
    : `${base}/legacy/${encodeURIComponent(file.id)}/?activityId=${encodeURIComponent(file.activityId)}`;
  return (await request<{ url: string }>(url)).url;
}

/** Every signable item across this employer's learners. */
export function fetchEmployerDocuments(employerId: string): Promise<EmployerDocuments> {
  return request<EmployerDocuments>(`${BASE}/${employerId}/documents/`);
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
 * The learner-dashboard reads behind the Overview tab, served through the portal.
 *
 * The learner's own dashboard endpoints admit only the learner and staff, so an
 * employer signed in to the portal gets these same payloads from here instead,
 * behind the portal's employer-owns-this-learner check. Meeting and booking
 * links come back empty: the employer's view is read-only.
 */
function overviewPart<T>(employerId: string, kind: string, learnerId: string, part: string, signal?: AbortSignal) {
  return request<T>(`${BASE}/${employerId}/learner/${kind}/${learnerId}/overview/${part}/`, { signal });
}

export function fetchEmployerLearnerWeek(employerId: string, kind: LearnerKind, learnerId: string, signal?: AbortSignal) {
  return overviewPart<OverviewWeek>(employerId, kind, learnerId, 'week', signal);
}

export function fetchEmployerLearnerSchedule(employerId: string, kind: LearnerKind, learnerId: string, signal?: AbortSignal) {
  return overviewPart<TrainingPlanDashboard>(employerId, kind, learnerId, 'schedule', signal);
}

export function fetchEmployerLearnerContract(employerId: string, kind: LearnerKind, learnerId: string, signal?: AbortSignal) {
  return overviewPart<TrainingPlanContract>(employerId, kind, learnerId, 'contract', signal);
}

/** Per-month hour totals only — no activity rows or signatures. */
export function fetchEmployerLearnerHours(employerId: string, kind: LearnerKind, learnerId: string, signal?: AbortSignal) {
  return overviewPart<MonthlyLogHours>(employerId, kind, learnerId, 'hours', signal);
}

/** The learner's profile photo, or null when they have not added one. */
export async function fetchEmployerLearnerPhoto(employerId: string, kind: LearnerKind, learnerId: string, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/${employerId}/learner/${kind}/${learnerId}/overview/photo/`, { credentials: 'include', signal });
  if (res.status === 204) return null;
  if (!res.ok || !res.headers.get('Content-Type')?.startsWith('image/jpeg')) throw new Error('The photo could not be loaded.');
  return res.blob();
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
): Promise<unknown> {
  return request(
    `${BASE}/${employerId}/learner/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/review/`,
  );
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
    { method: 'POST', body: JSON.stringify({ party: 'employer', ...input }) },
  );
}

/** Save the employer's own answers to whichever fields the Curriculum
 * template opted the Employer into answering -- every other field id is
 * rejected server-side, so only the fields this form actually unlocked
 * should ever be posted here. A distinct payload shape (`answers`, not
 * `party`/`signature`) from signReviewAsEmployer above, so it never touches
 * the sign-off flow. */
export function saveEmployerReviewAnswers(
  employerId: string,
  kind: string,
  learnerId: string,
  eventKey: string,
  answers: Record<string, unknown>,
): Promise<unknown> {
  return request(
    `${BASE}/${employerId}/learner/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/review/`,
    { method: 'POST', body: JSON.stringify({ answers }) },
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
