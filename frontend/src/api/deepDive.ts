import { readLearnerJson } from './learnerRead';

export interface DeepDiveReviewItem {
  number: number;
  date: string;
  status: string;
}

export interface DeepDiveOperationalDetails {
  mcm?: { last: string; next: string; lastCompleted: string; dates: DeepDiveReviewItem[] };
  pr?: { last: string; next: string; lastCompleted: string; dates: DeepDiveReviewItem[] };
  progress?: {
    otjhPlanned: string;
    otjhExpected: string;
    otjhActual: string;
    expectedProgression: string;
    actualProgression: string;
    progressVariance: string;
    progressHours: string;
    riskRating: string;
    otjhStatus: string;
    ksbTarget: string;
    ksbCompleted: string;
    ksbStatus: string;
    disability: string;
  };
  inclusion?: {
    lldd: string;
    llddCategories: string[];
    demographicsMatched: boolean | null;
    otjStatus: string;
    otjCompleted: string;
    otjExpected: string;
    ksbCompleted: string;
    ksbTarget: string;
    latestMonthly: string;
    latestReview: string;
  };
  plr?: { records: number };
  declarations?: unknown;
  functionalSkillsExemptions?: { english: unknown; maths: unknown; ict: unknown };
}

export interface DeepDiveRecord {
  id: string;
  identityKey: string;
  sourceFileName: string;
  sourceFileHash: string;
  sourceSheet: string;
  sourceRow: number | null;
  lmsLearnerId: string | null;
  firstName: string;
  surname: string;
  fullName: string;
  dateOfBirth: string;
  uln: string;
  qualification: string;
  level: string;
  startDate: string;
  practicalEndDate: string;
  apprenticeshipEndDate: string;
  plannedGatewayDate: string;
  plannedEpaDate: string;
  observer: string;
  reviewedBy: string;
  notes: string;
  operational: DeepDiveOperationalDetails;
  raw: Record<string, unknown>;
  version: number;
  updatedBy: string;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DeepDiveImportRow {
  identityKey: string;
  sourceSheet: string;
  sourceRow: number;
  firstName: string;
  surname: string;
  fullName: string;
  dateOfBirth: string;
  uln: string;
  qualification: string;
  level: string;
  startDate: string;
  practicalEndDate: string;
  apprenticeshipEndDate: string;
  plannedGatewayDate: string;
  plannedEpaDate: string;
  observer?: string;
  reviewedBy?: string;
  notes?: string;
  raw: Record<string, unknown>;
  reference?: string;
  email?: string;
}

async function write<T>(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const response = await fetch(url, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || `Deep Dive request failed (${response.status})`);
  return data;
}

export function fetchDeepDiveRecords() {
  return readLearnerJson<{ count: number; records: DeepDiveRecord[] }>('/qms_api/deep-dive/records/');
}

export function fetchDeepDiveSummaries() {
  return readLearnerJson<{ count: number; records: DeepDiveRecord[] }>('/qms_api/deep-dive/records/summary/');
}

export function fetchDeepDiveRecord(id: string) {
  return readLearnerJson<{ record: DeepDiveRecord }>(`/qms_api/deep-dive/records/${encodeURIComponent(id)}/`)
    .then((result) => result.record);
}

export function fetchDeepDiveIlrContact(id: string) {
  return readLearnerJson<{ uln: string | null; postcode: string | null }>(`/qms_api/deep-dive/records/${encodeURIComponent(id)}/ilr/`);
}

export function importDeepDiveWorkbook(sourceFileName: string, sourceFileHash: string, records: DeepDiveImportRow[]) {
  return write<{ count: number; matched: number; records: DeepDiveRecord[] }>('/qms_api/deep-dive/import/', { sourceFileName, sourceFileHash, records });
}

export function syncDeepDiveFromCreatedUsers() {
  return write<{ month: string; added: number; remaining: number; records: DeepDiveRecord[]; runId: number }>('/qms_api/deep-dive/sync/', {});
}

export function updateDeepDiveRecord(id: string, expectedVersion: number, patch: Partial<Pick<DeepDiveRecord, 'firstName' | 'surname' | 'fullName' | 'dateOfBirth' | 'uln' | 'qualification' | 'level' | 'startDate' | 'practicalEndDate' | 'apprenticeshipEndDate' | 'plannedGatewayDate' | 'plannedEpaDate' | 'observer' | 'reviewedBy' | 'notes' | 'operational'>>) {
  return write<{ record: DeepDiveRecord }>(`/qms_api/deep-dive/records/${encodeURIComponent(id)}/`, { expectedVersion, ...patch }, 'PATCH').then((result) => result.record);
}

export function markDeepDiveRecordReviewed(id: string, expectedVersion: number) {
  return write<{ record: DeepDiveRecord }>(`/qms_api/deep-dive/records/${encodeURIComponent(id)}/`, { expectedVersion, markReviewed: true }, 'PATCH').then((result) => result.record);
}

export async function workbookToDeepDiveRows(file: File): Promise<DeepDiveImportRow[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: false });
  const rows: DeepDiveImportRow[] = [];
  const seen = new Set<string>();
  const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const text = (value: unknown) => String(value ?? '').trim();
  const valueFor = (row: Record<string, unknown>, headers: string[], ...names: string[]) => {
    const header = headers.find((item) => names.includes(normalizeHeader(item)));
    return header ? text(row[header]) : '';
  };
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const values = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    const headers = values.length ? Object.keys(values[0]) : [];
    values.forEach((row, index) => {
      const firstName = valueFor(row, headers, 'firstname', 'forename');
      const surname = valueFor(row, headers, 'surname', 'lastname', 'familyname');
      const fullName = [firstName, surname].filter(Boolean).join(' ') || valueFor(row, headers, 'name', 'learnername');
      const dateOfBirth = valueFor(row, headers, 'dateofbirth', 'dob');
      const uln = valueFor(row, headers, 'uln', 'uniquelernernumber', 'uniquelearnernumber');
      const qualification = valueFor(row, headers, 'qualification', 'aimqualification');
      const level = valueFor(row, headers, 'level');
      if (!fullName && !uln) return;
      const identityKey = uln ? `uln:${uln}` : `learner:${fullName.toLowerCase()}|${dateOfBirth.toLowerCase()}`;
      if (seen.has(identityKey)) return;
      seen.add(identityKey);
      rows.push({
        identityKey,
        sourceSheet: sheetName,
        sourceRow: index + 2,
        firstName,
        surname,
        fullName,
        dateOfBirth,
        uln,
        qualification,
        level,
        startDate: valueFor(row, headers, 'startdate', 'learnerstartdate'),
        practicalEndDate: valueFor(row, headers, 'practicalenddate', 'practicalperiodenddate'),
        apprenticeshipEndDate: valueFor(row, headers, 'apprenticeshipenddate', 'apprenticeshipend'),
        plannedGatewayDate: valueFor(row, headers, 'plannedgw', 'plannedgateway', 'plannedgatewaydate'),
        plannedEpaDate: valueFor(row, headers, 'plannedepadate', 'plannedepa', 'plannedepadate'),
        observer: valueFor(row, headers, 'observer', 'observedby', 'observedbyname'),
        reviewedBy: valueFor(row, headers, 'reviewedby', 'reviewer', 'reviewedbyname'),
        notes: valueFor(row, headers, 'notes', 'note', 'comments'),
        raw: row,
      });
    });
  });
  if (!rows.length) throw new Error('No learner rows were found in the workbook.');
  return rows;
}

export async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

