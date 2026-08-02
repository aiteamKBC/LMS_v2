// ============================================================================
// Extended ILR API client
// Talks to the Django backend at /enrolment_api (proxied to :8000 by Vite in dev).
//
// The questionnaire is stored as one jsonb document, so this client posts the
// wizard's IlrForm as-is and the server derives the signature/completion flags.
// ============================================================================
import type { IlrForm, WizardDraft } from '@/pages/users/types';

const BASE = '/enrolment_api/extended-ilr';

export type LearnerKind = 'apprenticeship' | 'commercial';

/** Every wizard step except the ILR, which travels in `answers`. */
export type WizardDraftRest = Omit<WizardDraft, 'ilr'>;

export interface ExtendedIlrMeta {
  learnerKind: LearnerKind;
  learnerId: number;
  learnerName: string;
  learnerSigned: boolean;
  learnerSignedDate: string;
  providerSigned: boolean;
  providerSignedDate: string;
  completed: boolean;
  updatedAt: string;
}

export interface ExtendedIlrResponse {
  /** null when the learner has no saved ILR yet — the form opens blank. */
  answers: IlrForm | null;
  /** The wizard's other steps; null/{} when nothing has been saved yet. */
  draft: Partial<WizardDraftRest> | null;
  meta: ExtendedIlrMeta;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export function fetchExtendedIlr(kind: LearnerKind, learnerId: string): Promise<ExtendedIlrResponse> {
  return request<ExtendedIlrResponse>(`${BASE}/${kind}/${learnerId}/`);
}

/**
 * Persist the wizard. `draft` carries every non-ILR step; omit it and any stored
 * draft is left as-is rather than cleared.
 */
export function saveExtendedIlr(
  kind: LearnerKind,
  learnerId: string,
  answers: IlrForm,
  draft?: WizardDraftRest
): Promise<ExtendedIlrResponse> {
  return request<ExtendedIlrResponse>(`${BASE}/${kind}/${learnerId}/`, {
    method: 'PUT',
    body: JSON.stringify(draft ? { answers, draft } : { answers }),
  });
}
