// ============================================================================
// delivery API client
// Talks to the Django backend at /learner_api (proxied to :8000 by Vite in dev).
// Backs enrolment."Commercial_users".
// ============================================================================

import type { TrainingPlan } from './trainingPlan';
import type { EnrolmentBoard } from '@/pages/users/types';
import type { AptemUserFields } from './enrolmentUsers';

const BASE = '/learner_api/commercial-users';

export interface CommercialUserRow extends AptemUserFields {
  id: string;
  username: string;
  /** Type/Status columns this table gained with the shared Aptem create form. */
  type?: string;
  status?: string;
  dob?: string;
  email: string;
  phone: string;
  employer: string;
  lineManager: string;
  organization: string;
  programmeStatus: string;
  programme: string;
  cohort: string;
  group: string;
  /** @deprecated legacy comma-joined summaries — use trainingPlan instead */
  modules: string;
  /** @deprecated legacy comma-joined summaries — use trainingPlan instead */
  weeks: string;
  /** @deprecated legacy comma-joined summaries — use trainingPlan instead */
  components: string;
  trainingPlan: TrainingPlan;
}

export interface CreateCommercialUserInput extends AptemUserFields {
  username: string;
  email: string;
  phone?: string;
  employer?: string;
  lineManager?: string;
  organization?: string;
  programmeStatus?: string;
  /** Commercial_users gained these columns so both tables share one create form. */
  type?: string;
  status?: string;
  dob?: string;
  programme?: string;
  cohort?: string;
  group?: string;
}

export interface CommercialProgrammeInput {
  programme?: string;
  cohort?: string;
  group?: string;
  trainingPlan?: TrainingPlan;
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

/** List all commercial users (mapped to CommercialUserRow). */
export async function fetchCommercialUsers(): Promise<CommercialUserRow[]> {
  const data = await request<{ count: number; results: CommercialUserRow[] }>(`${BASE}/`);
  return data.results;
}

/** Step 1: create the commercial user's details. */
export function createCommercialUser(input: CreateCommercialUserInput): Promise<CommercialUserRow> {
  return request<CommercialUserRow>(`${BASE}/`, { method: 'POST', body: JSON.stringify(input) });
}

/** Fetch a single commercial user. */
export function fetchCommercialUser(id: string): Promise<CommercialUserRow> {
  return request<CommercialUserRow>(`${BASE}/${id}/`);
}

/** Step 2: attach programme details to the previously created commercial user. */
export function updateCommercialProgramme(id: string, patch: CommercialProgrammeInput): Promise<CommercialUserRow> {
  return request<CommercialUserRow>(`${BASE}/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/**
 * Wizard board for a commercial learner, projected onto the EnrolmentBoard
 * shape by enrolment_api. Sections the commercial table has no columns for come
 * back empty, so the wizard renders those steps blank instead of erroring.
 */
export function fetchCommercialBoard(id: string): Promise<EnrolmentBoard> {
  return request<EnrolmentBoard>(`/enrolment_api/commercial-users/${id}/board/`);
}

/** Save wizard edits for a commercial learner (flat columns + training plan). */
export function updateCommercialBoard(id: string, patch: Record<string, unknown>): Promise<EnrolmentBoard> {
  return request<EnrolmentBoard>(`/enrolment_api/commercial-users/${id}/board/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Patch any writable commercial-user fields (e.g. status). */
export function updateCommercialUser(
  id: string,
  patch: Partial<CreateCommercialUserInput> & CommercialProgrammeInput,
): Promise<CommercialUserRow> {
  return request<CommercialUserRow>(`${BASE}/${id}/`, { method: 'PATCH', body: JSON.stringify(patch) });
}
