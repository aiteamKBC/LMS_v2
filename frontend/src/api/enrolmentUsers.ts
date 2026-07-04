// ============================================================================
// Enrolment users API client
// Talks to the Django backend at /api (proxied to :8000 by Vite in dev).
// ============================================================================
import type { UserListRow, EnrolmentBoard } from '@/pages/users/types';

const BASE = '/api/enrolment-users';

// ---- Canonical option lists (mirror api/constants.py; validated server-side) ----
export const STATUS_OPTIONS = ['FullUser', 'Invited', 'Prospect', 'Expired', 'Cancelled', 'Archived'];

export const TYPE_OPTIONS = ['User', 'Employer', 'Referrer', 'Admin', 'Caseowner'];

export const PROGRAMME_STATUS_OPTIONS = [
  'Ready to enrol',
  'On probation',
  'Active',
  'Non starter',
  'Under review',
  'On maternity break',
  'On illness break',
  'On other break',
  'Entered EPA',
  'Completed',
  'Withdrawn (w/o funding)',
  'Early Leaver (funded)',
  'Not Eligible',
  'Imported',
  'On a break',
  'Withdrawn',
  'Pending Change of Programme',
  'Did Not Attend',
  'Early Completer',
  'Left Employment Active',
  'In Work (Mandatory)',
  'Outcome',
  'Tracking',
  'In Work (Voluntary)',
];

export interface CreateEnrolmentUserInput {
  username: string;
  email: string;
  type?: string;
  status?: string;
  programmeStatus?: string;
  programme?: string;
  cohort?: string;
  group?: string;
  employer?: string;
  organization?: string;
  lineManager?: string;
  phone?: string;
  dob?: string;
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

/** List all enrolment users (mapped to UserListRow). */
export async function fetchEnrolmentUsers(): Promise<UserListRow[]> {
  const data = await request<{ count: number; results: UserListRow[] }>(`${BASE}/`);
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
