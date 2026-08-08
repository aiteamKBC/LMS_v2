// ============================================================================
// Compliance documents — the learner-facing view of their statutory paperwork.
//
// Generated PDFs live in Azure and are indexed in enrolment."Enrolment_Documents"
// (see backend/enrolment_api/documents.py). This client adds the pieces the
// learner's own page needs: the data an Apprenticeship Agreement is filled from,
// and the learner's side of the two-party sign-off.
// ============================================================================
import type { LearnerKind } from './extendedIlr';

const LEARNER_BASE = '/learner_api';
const DOCS_BASE = '/enrolment_api';

export interface AgreementParticularsResponse {
  learner: { id: string; name: string; programmeStatus: string };
  particulars: {
    apprenticeName: string;
    employerName: string;
    employerAddress: string;
    standard: string;
    startDate: string;
    endDate: string;
    practicalStartDate: string;
    practicalEndDate: string;
    plannedOtjHours: number;
  };
  /**
   * The signature the learner drew during enrolment, offered as the default so
   * they reuse the mark they already gave. Empty when they never signed one.
   */
  savedLearnerSignature?: { signature?: string; name?: string; date?: string | null };
  meta: {
    /** 'group' when the dates came from the learner's group, else 'learner'. */
    datesFrom: string;
    moduleCount: number;
    planSaved: boolean;
    group: string;
    cohort: string;
  };
}

export type SigningParty = 'learner' | 'employer';

export interface DocumentSignature {
  name: string;
  signedAt: string | null;
  signed: boolean;
}

export interface ComplianceDocument {
  id: string;
  docType: string;
  docLabel: string;
  filename: string;
  path: string;
  sizeBytes: number | null;
  signed: boolean;
  generatedAt: string | null;
  learner?: DocumentSignature;
  employer?: DocumentSignature;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

/** The values the Apprenticeship Agreement PDF is rendered from. */
export async function fetchAgreementParticulars(
  learnerId: string,
): Promise<AgreementParticularsResponse> {
  return readJson(await fetch(`${LEARNER_BASE}/apprenticeship-agreement/${learnerId}/`));
}

/** Documents already generated for this learner. */
export async function fetchComplianceDocuments(
  kind: LearnerKind,
  learnerId: string,
  docType?: string,
): Promise<ComplianceDocument[]> {
  const qs = docType ? `?doc_type=${encodeURIComponent(docType)}` : '';
  const data = await readJson<{ results: ComplianceDocument[] }>(
    await fetch(`${DOCS_BASE}/documents/${kind}/${learnerId}/${qs}`),
  );
  return data.results;
}

/** Store a generated PDF. Multipart so the file isn't base64-inflated. */
export async function uploadComplianceDocument(
  kind: LearnerKind,
  learnerId: string,
  docType: string,
  file: Blob,
  filename: string,
): Promise<ComplianceDocument> {
  const body = new FormData();
  body.append('doc_type', docType);
  body.append('file', file, filename);
  return readJson(
    await fetch(`${DOCS_BASE}/documents/${kind}/${learnerId}/`, { method: 'POST', body }),
  );
}

/**
 * Sign a document as one party. Posting an empty signature withdraws that
 * party's sign-off, so a mistaken signature can be undone.
 */
export async function signComplianceDocument(
  kind: LearnerKind,
  learnerId: string,
  docId: string,
  party: SigningParty,
  name: string,
  signature: string,
): Promise<ComplianceDocument> {
  return readJson(
    await fetch(`${DOCS_BASE}/documents/${kind}/${learnerId}/${docId}/sign/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ party, name, signature }),
    }),
  );
}

/**
 * Replace the stored PDF on an existing document, keeping its id and any
 * signatures already recorded. Used after a party signs: the filed PDF was
 * generated before anyone signed, so it must be rebuilt with their mark.
 *
 * Uploading to the collection endpoint instead would create a second document
 * and strand the signature on the first.
 */
export async function replaceComplianceDocumentFile(
  kind: LearnerKind,
  learnerId: string,
  docId: string,
  file: Blob,
  filename: string,
): Promise<ComplianceDocument> {
  const body = new FormData();
  body.append('file', file, filename);
  return readJson(
    await fetch(`${DOCS_BASE}/documents/${kind}/${learnerId}/${docId}/file/`, {
      method: 'POST',
      body,
    }),
  );
}

export function documentDownloadUrl(kind: LearnerKind, learnerId: string, docId: string): string {
  return `${DOCS_BASE}/documents/${kind}/${learnerId}/${docId}/download/`;
}
