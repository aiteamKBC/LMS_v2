// Monthly journal sign-off client for the MANUAL audit workspace. Same
// contract as the automatic workspace's signoff client
// (frontend/src/features/audit/api.ts) but pointed at manual_audit_api, so the
// two systems store their sign-offs independently.
const BASE = '/manual_audit_api/learners';

export interface AuditSignoff {
  id?: number;
  signer_role: 'learner' | 'coach';
  signer_name: string;
  review_confirmed: boolean;
  signature_data: string;
  signed_at: string;
  snapshot_hash?: string;
  audit_version?: string;
  created_at?: string;
  updated_at?: string;
  is_stale?: boolean;
  status_message?: string;
}

export interface AuditSignoffPayload {
  monthKey: string;
  roles: {
    learner: { signerName: string; signature: string; confirmed: boolean; signedAt: string };
    coach: { signerName: string; signature: string; confirmed: boolean; signedAt: string };
  };
}

export interface AuditSignoffResponse {
  learnerId: string;
  month: string;
  signoffs: { learner: AuditSignoff | null; coach: AuditSignoff | null };
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? String((data as { error?: string }).error)
      : `Request failed with ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchAuditSignoff(learnerId: string, monthKey: string): Promise<AuditSignoffResponse> {
  const params = new URLSearchParams({ month: monthKey });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${learnerId}/signoff/?${params.toString()}`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parse<AuditSignoffResponse>(res);
}

export async function saveAuditSignoff(learnerId: string, payload: AuditSignoffPayload): Promise<AuditSignoffResponse> {
  const params = new URLSearchParams({ month: payload.monthKey });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${learnerId}/signoff/?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parse<AuditSignoffResponse>(res);
}

export function auditBlobUrl(container: string, blob: string, filename?: string) {
  const params = new URLSearchParams({ container, blob });
  if (filename) params.set('filename', filename);
  return `/manual_audit_api/blob/?${params.toString()}`;
}
