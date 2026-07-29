const BASE = '/audit_api/learners';

export type AuditJsonValue = null | boolean | number | string | AuditJsonValue[] | { [key: string]: AuditJsonValue };
export type AuditRow = Record<string, AuditJsonValue>;

export interface LearnerAuditResponse {
  learnerId: string;
  learner: AuditRow | null;
  learnerRows: AuditRow[];
  azureManifest?: AuditRow | null;
  evidence: AuditRow[];
  related: Record<string, AuditRow[]>;
  meta: Record<string, { table: string; available: boolean; matchedBy: string | null }>;
}

export interface AuditLearnerSummary {
  learnerId: string;
  fullName: string;
  programName: string;
  evidenceCount: number;
  fetchedAt: string;
  latestEvidenceDate: string;
}

export interface AuditSignoffPayload {
  learnerName: string;
  programName: string;
  evidenceCount: number;
  learnerSignerName: string;
  learnerSignature: string;
  learnerConfirmed: boolean;
  learnerSignedAt: string;
  coachSignerName: string;
  coachSignature: string;
  coachConfirmed: boolean;
  coachSignedAt: string;
  pdfFileName: string;
}

export type AuditSignoffResponse = Record<string, AuditJsonValue>;

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

export async function fetchLearnerAudit(learnerId: string, learnerName?: string): Promise<LearnerAuditResponse> {
  const params = new URLSearchParams();
  if (learnerName) params.set('name', learnerName);
  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(`${BASE}/${learnerId}/${qs}`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parse<LearnerAuditResponse>(res);
}

export async function fetchAuditLearners(options: { search?: string; limit?: number } = {}): Promise<AuditLearnerSummary[]> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(`${BASE}/${qs}`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ results: AuditLearnerSummary[] }>(res);
  return data.results;
}

export async function fetchAuditSignoff(learnerId: string): Promise<AuditSignoffResponse | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${learnerId}/signoff/`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ signoff: AuditSignoffResponse | null }>(res);
  return data.signoff;
}

export async function saveAuditSignoff(learnerId: string, payload: AuditSignoffPayload): Promise<AuditSignoffResponse | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${learnerId}/signoff/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ signoff: AuditSignoffResponse | null }>(res);
  return data.signoff;
}

export function auditBlobUrl(container: string, blob: string, filename?: string) {
  const params = new URLSearchParams({ container, blob });
  if (filename) params.set('filename', filename);
  return `/audit_api/blob/?${params.toString()}`;
}
