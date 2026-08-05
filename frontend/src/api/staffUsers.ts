// ============================================================================
// Staff / admin users API client
// Talks to the Django backend at /learner_api (proxied to :8000 by Vite in dev).
// Backs enrolment."Staff_users" — non-learner accounts created via the Create
// menu's "Create admin" option.
// ============================================================================
import type { UserListRow } from '@/pages/users/types';

const BASE = '/learner_api/staff-users';

/**
 * Staff positions. Mirrors POSITION_CHOICES in backend/learner_api/constants.py,
 * which validates writes — a value missing there is rejected on save.
 */
export const POSITION_OPTIONS = [
  'Caseowner',
  'Admin',
  'Enrolment',
  'Curriculum team',
  'Operations team',
];

export interface CreateStaffUserInput {
  username: string;
  email: string;
  /** Required — one of POSITION_OPTIONS. */
  position: string;
  type?: string;
  status?: string;
  phone?: string;
  dob?: string;
  title?: string;
  preferredName?: string;
  gender?: string;
  organization?: string;
  caseOwner?: string;
  learningProvider?: string;
  referenceNumber?: string;
  inviteToPlatform?: boolean;
  allowCheckpoint?: boolean;
  allowConsole?: boolean;
  allowClassic?: boolean;
}

/**
 * A staff row, shaped like a UserListRow so the directory can list learners and
 * staff in one table. `type` carries the staff position (Admin, Caseowner, ...).
 */
export interface StaffUserRow extends UserListRow {
  position: string;
  phone: string;
  organization: string;
  title: string;
  preferredName: string;
  gender: string;
  dob: string;
  caseOwner: string;
  learningProvider: string;
  referenceNumber: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

/** List staff/admin accounts, optionally restricted to the given positions. */
export async function fetchStaffUsers(positions?: string[]): Promise<StaffUserRow[]> {
  const qs = (positions ?? []).map((p) => `position=${encodeURIComponent(p)}`).join('&');
  const data = await request<{ count: number; results: StaffUserRow[] }>(`${BASE}/${qs ? `?${qs}` : ''}`);
  return data.results;
}

/**
 * Positions eligible to own a case. Only these staff appear in the create-user
 * form's Case owner dropdown.
 */
export const CASE_OWNER_POSITIONS = ['Caseowner', 'Admin'];

/**
 * Names for the Case owner dropdown, sourced from Staff_users. Returns the staff
 * whose position is Caseowner or Admin — a case owner has to be a real account,
 * so the list is whatever has actually been created.
 */
export async function fetchCaseOwners(): Promise<string[]> {
  const rows = await fetchStaffUsers(CASE_OWNER_POSITIONS);
  return rows.map((r) => r.name).filter(Boolean);
}

/** Create a staff/admin account; returns the new row. */
export function createStaffUser(input: CreateStaffUserInput): Promise<StaffUserRow> {
  return request<StaffUserRow>(`${BASE}/`, { method: 'POST', body: JSON.stringify(input) });
}

/** Patch a staff/admin account (e.g. change position). */
export function updateStaffUser(id: string, patch: Partial<CreateStaffUserInput>): Promise<StaffUserRow> {
  return request<StaffUserRow>(`${BASE}/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) });
}
