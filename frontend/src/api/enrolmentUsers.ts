// ============================================================================
// Enrolment users API client
// Talks to the Django backend at /learner_api (proxied to :8000 by Vite in dev).
// ============================================================================
import type { UserListRow, EnrolmentBoard } from '@/pages/users/types';

const BASE = '/learner_api/enrolment-users';

// ---- Canonical option lists (mirror api/constants.py; validated server-side) ----
export const STATUS_OPTIONS = ['FullUser', 'Invited', 'Prospect', 'Expired', 'Cancelled', 'Archived'];

export const TYPE_OPTIONS = ['User', 'Employer', 'Referrer', 'Admin', 'Caseowner'];

// Mirrors PROGRAMME_STATUS_CHOICES in backend/learner_api/constants.py, which
// validates writes — a value missing there is rejected on save.
export const PROGRAMME_STATUS_OPTIONS = [
  // Account exists but the learner hasn't entered the enrolment flow yet. Also
  // what the backend reports when no status has been set.
  'Fresh user',
  // While a learner is at this status their landing page sends them to their own
  // enrolment wizard (/learner/onboarding) rather than the usual overview.
  'Onboarding',
  'Delivery',
  'Ready to enrol',
  'Active',
  'Withdrawn',
  'On break',
  'Completed',
];

/**
 * The Aptem "Add user" field set, shared by both learner tables — the create
 * form is the same for apprenticeship and commercial learners, and the backend
 * accepts these keys on either endpoint (see APTEM_TEXT_FIELDS/APTEM_BOOL_FIELDS
 * in backend/learner_api/mappers.py).
 */
export interface AptemUserFields {
  title?: string;
  preferredName?: string;
  gender?: string;
  legalSex?: string;
  age?: string;
  niNumber?: string;
  referrer?: string;
  referrerAddress?: string;
  referrerContact?: string;
  targetProgramme?: string;
  postcode?: string;
  address?: string;
  addressLine1?: string;
  addressLine2?: string;
  townCity?: string;
  county?: string;
  country?: string;
  caseOwner?: string;
  learningProvider?: string;
  employerAddress?: string;
  mentor?: string;
  referenceNumber?: string;
  extendedBreak?: string;
  /** Radio: invite the new user into the platform on create. */
  inviteToPlatform?: boolean;
  allowCheckpoint?: boolean;
  allowConsole?: boolean;
  allowClassic?: boolean;
}

/**
 * Which kind of learner a row is. Both kinds live in the single
 * enrolment."Enrolment_Users" table, distinguished by this column.
 */
export type LearnerType = 'apprenticeship' | 'commercial';

export const LEARNER_TYPE_OPTIONS: LearnerType[] = ['apprenticeship', 'commercial'];

export interface CreateEnrolmentUserInput extends AptemUserFields {
  username: string;
  email: string;
  /** Defaults to 'apprenticeship' server-side when omitted. */
  learnerType?: LearnerType;
  type?: string;
  status?: string;
  programmeStatus?: string;
  programme?: string;
  cohort?: string;
  group?: string;
  employer?: string;
  /**
   * The employer's record id in enrolment."Employers". `employer` above is the
   * display name; this is the reference that reaches their full details. Null
   * clears it. The API rejects an id naming no employer record.
   */
  employerId?: number | null;
  organization?: string;
  lineManager?: string;
  phone?: string;
  dob?: string;
}

async function request<T>(url: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`The server returned ${res.headers.get('content-type') || 'a non-JSON response'} for ${url}.`);
    }
  }
  if (!res.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? String(data.error) : '';
    throw new Error(error || `Request failed (${res.status})`);
  }
  return data as T;
}

/**
 * List learners from the single learner table. Both kinds are returned unless
 * `learnerType` narrows it — each row carries its own `learnerType`/`source`.
 */
export async function fetchEnrolmentUsers(learnerType?: LearnerType): Promise<UserListRow[]> {
  const qs = learnerType ? `?learnerType=${encodeURIComponent(learnerType)}` : '';
  const data = await request<{ count: number; results: UserListRow[] }>(`${BASE}/${qs}`);
  return data.results;
}

/** Full read-only board for a single user. */
export function fetchEnrolmentBoard(id: string): Promise<EnrolmentBoard> {
  return request<EnrolmentBoard>(`${BASE}/${id}/`);
}

/** Create a user; returns the new list row. */
export function createEnrolmentUser(input: CreateEnrolmentUserInput): Promise<UserListRow> {
  return request<UserListRow>(`${BASE}/`, { method: 'POST', body: JSON.stringify(input) });
}

/** Update flat fields on a user (e.g. wizard save-back); returns the board. */
export function updateEnrolmentUser(id: string, patch: Partial<CreateEnrolmentUserInput> & Record<string, unknown>): Promise<EnrolmentBoard> {
  return request<EnrolmentBoard>(`${BASE}/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/**
 * Finish enrolment: promote the learner out of enrolment."Created_users" into
 * the live learner tables, set them Active and start their journey. Until this
 * is called the learner exists only as an enrolment record.
 */
export function finishEnrolment(id: string): Promise<EnrolmentBoard> {
  return request<EnrolmentBoard>(`${BASE}/${id}/finish/`, { method: 'POST' });
}
