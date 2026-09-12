import { readLearnerJson } from './learnerRead';
import type { LearnerKind } from '@/api/learnerDetail';

const BASE = '/learner_api/monthly-reports';

/** The section ref an uploaded monthly-report document is filed under. Reuses
 *  the evidence pipeline (quarantine -> scan -> approved) rather than adding a
 *  second upload path, so the file is scanned and downloadable like any other. */
export function monthlyReportSectionRef(monthKey: string) {
  return `monthly-report:${monthKey}`;
}

/** One document the learner attached to a monthly report. Kept denormalised on
 *  the report row so it renders without a join; the bytes live in evidence. */
export interface MonthlyReportAttachment {
  id: string;
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  /** The malware-scan verdict from the upload pipeline. Only an 'approved' file
   *  can be opened — the download endpoint refuses anything still in
   *  quarantine, so offering the action would be a dead link. Older rows omit
   *  it; treat a missing value as openable and let the server decide. */
  status?: string | null;
}

/** One timeline entry as it stood when the report was submitted. Snapshotted so
 *  a downloaded report always matches what the learner signed off, even after
 *  the curriculum, marking or calendar moves on. */
export interface MonthlyReportActivity {
  at: string;
  type: string;
  title: string;
  action: string;
  detail?: string | null;
  module?: string | null;
  week?: string | null;
  duration?: string | null;
  reportedTime?: string | null;
  ksbs?: string[];
  status?: string | null;
  score?: number | null;
  passed?: boolean | null;
}

export interface MonthlyReportMetrics {
  totalEvents?: number;
  activeDays?: number;
  loggedMinutes?: number;
  loggedLabel?: string;
  ksbCount?: number;
  ksbCodes?: string[];
}

/** A KSB the learner claims they worked on this month, chosen from the ones on
 *  their programme. The description travels with the code so the report still
 *  reads correctly if the curriculum rewords the KSB later. */
export interface MonthlyReportKsb {
  code: string;
  type?: string;
  description?: string;
}

export interface MonthlyReport {
  id: string;
  learnerKind: LearnerKind;
  learnerId: string;
  learnerName: string | null;
  programmeName: string | null;
  monthKey: string;
  monthLabel: string | null;
  status: string;
  learnedSummary: string;
  activitySnapshot: MonthlyReportActivity[];
  summaryMetrics: MonthlyReportMetrics;
  attachments: MonthlyReportAttachment[];
  selectedKsbs: MonthlyReportKsb[];
  /** The sign-off as it was signed, held on the report itself so re-saving a
   *  reusable signature never rewrites what the learner already signed. */
  signature: string;
  signedName: string;
  signedAt: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface SubmitMonthlyReportInput {
  monthKey: string;
  monthLabel: string;
  learnedSummary: string;
  learnerName?: string;
  programmeName?: string;
  activitySnapshot: MonthlyReportActivity[];
  summaryMetrics: MonthlyReportMetrics;
  attachments: MonthlyReportAttachment[];
  selectedKsbs: MonthlyReportKsb[];
  /** Required — an image data URL. The server rejects a submit without one. */
  signature: string;
  signedName: string;
  /** Also keep this signature on the learner's own record for next time. */
  saveSignature?: boolean;
}

/** The months already reported on, plus the learner's reusable signature when
 *  they have saved one. */
export interface MonthlyReportsResponse {
  reports: MonthlyReport[];
  savedSignature: string;
  savedSignatureName: string;
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

/** Every month this learner has already submitted a report for, plus their
 *  saved signature if they have one. */
export async function fetchMonthlyReports(
  kind: LearnerKind,
  id: string,
): Promise<MonthlyReportsResponse> {
  const data = await readLearnerJson<Partial<MonthlyReportsResponse>>(`${BASE}/${kind}/${id}/`);
  return {
    reports: data.reports || [],
    savedSignature: data.savedSignature || '',
    savedSignatureName: data.savedSignatureName || '',
  };
}

/** Same-origin URL for one attached document's bytes.
 *
 * Distinct from the evidence download URL, which is a cross-origin Azure SAS
 * link: that opens fine in a new tab but cannot reliably be read with `fetch`,
 * because whether CORS permits it depends on the storage account's rules. This
 * route serves the same bytes from this origin, which is what building an
 * attachment into the downloaded report requires. */
export function monthlyReportAttachmentUrl(
  kind: LearnerKind,
  id: string,
  fileId: string,
) {
  return `${BASE}/${kind}/${id}/attachments/${fileId}/`;
}

/** Submit (or resubmit) the report for one month. */
export async function submitMonthlyReport(
  kind: LearnerKind,
  id: string,
  input: SubmitMonthlyReportInput,
): Promise<MonthlyReport> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${kind}/${id}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ report: MonthlyReport }>(res);
  return data.report;
}
