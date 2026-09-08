const BASE = '/login_api/admin/evidence';

async function request<T>(url: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`The server returned an unexpected response (${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

function query(params: object): string {
  const search = new URLSearchParams();
  Object.entries(params as Record<string, string | number | undefined>).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

export interface ClassifiedLearner {
  learnerId: number;
  fullName: string;
  programme: string;
  runId: number | null;
  assignmentsFound: number;
  uniqueAssignmentsEvaluated: number;
  assignmentsSelected: number;
  portfolioReadiness: string;
  selectionStatus: string;
  portfolioSummary: string;
  humanChecksRequired: number;
  completedAt: string | null;
  hasCompletedRun: boolean;
}

export interface Paged<T> {
  count: number;
  page: number;
  pageSize: number;
  results: T[];
}

export interface ClassifiedLearnerQuery {
  q?: string;
  programme?: string;
  found?: number;
  evaluated?: number;
  selectedCount?: number;
  portfolioReadiness?: string;
  selection?: 'recommended' | 'none' | 'unclassified' | '';
  humanVerification?: 'yes' | '';
  page?: number;
  pageSize?: number;
}

export function fetchClassifiedLearners(filters: ClassifiedLearnerQuery = {}) {
  return request<Paged<ClassifiedLearner> & { programmes: string[] }>(`${BASE}/classified-learners/${query(filters)}`);
}

export interface AssignmentClassification {
  evidenceId: number;
  componentId: number;
  evidenceName: string;
  componentName: string;
  assignmentDate: string | null;
  rank: number | null;
  finalScore: number;
  classification: string;
  auditReadiness: string;
  selected: boolean;
  manuallySelected?: boolean;
  selectionReasons: string[];
  reasonNotSelected: string;
  verifiedKsbCodes: string[];
  knowledgeFound: boolean;
  skillsFound: boolean;
  behavioursFound: boolean;
  keyStrengths: string[];
  weaknesses: string[];
  risks: string[];
  workplaceEvidenceSummary: string;
  feedbackQualitySummary: string;
  humanVerificationRequired: boolean;
  humanVerificationReason: string;
  hasFile: boolean;
  hasReport: boolean;
  filePreviewPath: string | null;
  reportPreviewPath: string | null;
}

export interface LearnerClassificationMeta {
  learnerId: number;
  fullName: string;
  programme: string;
  runId: number | null;
  portfolioReadiness: string;
  selectionStatus: string;
  portfolioSummary: string;
  completedAt: string | null;
}

export interface AssignmentPage extends Paged<AssignmentClassification> {
  learner: LearnerClassificationMeta;
  view: 'recommended' | 'all';
  sort: string;
}

export function fetchLearnerAssignments(
  learnerId: number,
  options: { view: 'recommended' | 'all'; sort?: string; page?: number; pageSize?: number },
) {
  return request<AssignmentPage>(
    `${BASE}/classified-learners/${learnerId}/assignments/${query(options)}`,
  );
}

export function setAssignmentSelection(
  learnerId: number,
  evidenceId: number,
  runId: number,
  componentId: number,
  selected: boolean,
) {
  return request<{ selected: boolean }>(
    `${BASE}/classified-learners/${learnerId}/evidence/${evidenceId}/selection/`,
    { runId, componentId, selected },
  );
}

export function updateAssignmentKsbCodes(
  learnerId: number,
  evidenceId: number,
  runId: number,
  componentId: number,
  verifiedKsbCodes: string[],
) {
  return request<{ verifiedKsbCodes: string[] }>(
    `${BASE}/classified-learners/${learnerId}/evidence/${evidenceId}/ksb-codes/`,
    { runId, componentId, verifiedKsbCodes },
  );
}

export interface AssessmentReportForm {
  learner_name: string;
  activity_name: string;
  evidence_name: string;
  time_spent: number | string;
  result: string;
  assessor: string;
  date: string;
  criteria: string;
  comments: string;
}

export interface AssessmentReportPrefill extends Omit<AssessmentReportForm, 'criteria' | 'comments'> {
  result_options: string[];
  has_report: boolean;
}

export function fetchAssessmentReportForm(learnerId: number, evidenceId: number) {
  return request<AssessmentReportPrefill>(
    `${BASE}/classified-learners/${learnerId}/evidence/${evidenceId}/report-form/`,
  );
}

export function saveAssessmentReportForm(learnerId: number, evidenceId: number, form: AssessmentReportForm, reanalyze: boolean) {
  return request<{ report_blob: string; analysis_required: boolean; analysis_preserved: boolean; reanalyze_queued: boolean; job_id: string | number | null }>(
    `${BASE}/classified-learners/${learnerId}/evidence/${evidenceId}/report-form/save/`,
    { ...form, reanalyze },
  );
}

export interface EvidenceDocumentUrl {
  id: number;
  name: string;
  contentType: string | null;
  url: string;
  downloadUrl: string;
  expiresAt: string;
  textPreviewPath: string | null;
}

export function fetchEvidenceDocument(path: string) {
  return request<EvidenceDocumentUrl>(path);
}

export function fetchEvidenceText(path: string) {
  return request<{ id: number; text: string }>(path);
}
