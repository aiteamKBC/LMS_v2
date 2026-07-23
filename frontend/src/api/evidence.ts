import type { LearnerKind } from '@/api/learnerDetail';

const BASE = '/learner_api/evidence';

export interface EvidenceRecord {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending' | 'approved' | 'rejected' | string;
  scanResult: string | null;
  sectionRef: string;
  uploadedAt: string | null;
}

export interface UploadEvidenceResult {
  id: string;
  status: string;
  scanResult: string;
  filename: string;
  sectionRef: string;
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
    const message = (data as { error?: string } | null)?.error || `Request failed with ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

/** Upload a file as workplace evidence. Lands in quarantine, is promoted to the
 * approved container, and (on approval) recorded in "Learner"."Evidence". */
export async function uploadEvidence(
  kind: LearnerKind,
  id: string,
  file: File,
  sectionRef: string,
): Promise<UploadEvidenceResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('section_ref', sectionRef);
  let res: Response;
  try {
    // NOTE: do not set Content-Type — the browser sets the multipart boundary.
    res = await fetch(`${BASE}/${kind}/${id}/upload/`, { method: 'POST', body: form });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parse<UploadEvidenceResult>(res);
}

export async function fetchEvidence(
  kind: LearnerKind,
  id: string,
  opts: { sectionRef?: string; status?: string } = {},
): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (opts.sectionRef) params.set('section_ref', opts.sectionRef);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(`${BASE}/${kind}/${id}/${qs}`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ results: EvidenceRecord[] }>(res);
  return data.results;
}

/** Get a short-lived SAS download URL for an approved evidence file. */
export async function getEvidenceDownloadUrl(kind: LearnerKind, id: string, fileId: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${kind}/${id}/${fileId}/download/`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ url: string }>(res);
  return data.url;
}
