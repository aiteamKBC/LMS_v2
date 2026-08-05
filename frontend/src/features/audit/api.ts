const BASE = '/audit_api/learners';

export type AuditJsonValue = null | boolean | number | string | AuditJsonValue[] | { [key: string]: AuditJsonValue };
export type AuditRow = Record<string, AuditJsonValue>;

export interface AuditWarning {
  code: string;
  message: string;
  path?: string;
  severity?: 'info' | 'warning' | 'error' | string;
}

export interface AuditLearnerSummary {
  learnerId: string;
  fullName: string;
  programName: string;
  completedOtjh: number | null;
  aptemComponentCount: number | null;
  hasAptemData: boolean;
  hasLmsData: boolean;
  warnings: AuditWarning[];
  audit?: LearnerAuditResponse | null;
  activities?: AuditActivitySummary[];
}

export interface AuditActivitySummary {
  id: string;
  source: 'Aptem' | 'LMS';
  sourceId: string;
  title: string;
  subtitle: string;
  category: string;
  relevantDate: string | null;
  plannedHours: number;
  actualHours: number;
  done: boolean;
}

export interface AuditActivityStatsBucket {
  activities: number;
  actualHours: number;
  plannedHours: number;
  done: number;
}

export interface AuditActivityStats {
  learners: number;
  activities: number;
  actualHours: number;
  plannedHours: number;
  done: number;
  categories: Record<string, AuditActivityStatsBucket>;
}

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

export interface AuditItemBase {
  id: string;
  source: 'Aptem' | 'LMS';
  source_id: string;
  relevant_date: string | null;
  date_source: string | null;
  match_status: 'Matched' | 'Partially Matched' | 'Aptem Only' | 'LMS Only' | 'Needs Review';
  match_reason: string;
  matched_source_ids: string[];
  warning_codes: string[];
  warnings: AuditWarning[];
  raw: AuditRow;
}

export interface AptemAuditItem extends AuditItemBase {
  source: 'Aptem';
  activity_name: string;
  type: string;
  status: string;
  actual_hours: number | null;
  planned_hours: number | null;
  hours_variance: number | null;
  start_date: string | null;
  end_date: string | null;
}

export interface LmsAuditItem extends AuditItemBase {
  source: 'LMS';
  course_module: string;
  component_name: string;
  component_type: string;
  completion_status: string;
  tracked_seconds: number | null;
  quiz_attempts: number | null;
  quiz_score: number | null;
  tutor: string;
  course_started_at: string | null;
  course_completed_at: string | null;
}

export type AuditActivityItem = AptemAuditItem | LmsAuditItem;

export interface AuditWeek {
  week_key: string;
  label: string;
  start_date: string;
  end_date: string;
  aptem_items: AptemAuditItem[];
  lms_items: LmsAuditItem[];
  source_column?: string;
  source_note?: string;
  source_modules?: string[];
}

export interface AuditMonth {
  month_key: string;
  label: string;
  summary: {
    actual_hours: number | null;
    planned_hours: number | null;
    aptem_items: number;
    lms_items: number;
    completed: number;
    in_progress: number;
    not_started: number;
    warnings: number;
  };
  weeks: AuditWeek[];
  undated_items: AuditActivityItem[];
  signoffs: {
    learner: AuditSignoff | null;
    coach: AuditSignoff | null;
  };
}

export interface LearnerAuditResponse {
  learnerId: string;
  learner: {
    id: number | null;
    name: string | null;
    programme_name: string | null;
    programme_key: string;
    programme_start_date: string | null;
    employer: string | null;
    epa: string | null;
    epao: string | null;
    company_logo_url: string | null;
  };
  summary: {
    completed_otjh: number | null;
    approved_hours: number | null;
    planned_hours_month: number | null;
    planned_hours_to_date: number | null;
    total_programme_planned_hours: number | null;
    ksb_progression: string | number | null;
    lms_progress: number | null;
    tracked_seconds: number | null;
    components_completed: number | null;
    components_total: number | null;
    quiz_attempts: number | null;
  };
  months: AuditMonth[];
  signoffs: Record<string, { learner: AuditSignoff | null; coach: AuditSignoff | null }>;
  warnings: AuditWarning[];
  field_sources: Record<string, { table: string | null; column: string | null; join_key: string | null; fallback: string | null }>;
  source_status: {
    has_aptem_data: boolean;
    has_lms_data: boolean;
    lms_summary_fallback: boolean;
    quiz_summary_fallback: boolean;
  };
  audit_version: string;
  snapshot_hash: string;
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

const learnerAuditRequests = new Map<string, Promise<LearnerAuditResponse>>();
const learnerPageRequests = new Map<string, Promise<AuditLearnersResponse>>();

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

export async function fetchLearnerAudit(learnerId: string): Promise<LearnerAuditResponse> {
  const cachedRequest = learnerAuditRequests.get(learnerId);
  if (cachedRequest) return cachedRequest;
  let res: Response;
  const request = (async () => {
    try {
      res = await fetch(`${BASE}/${learnerId}/`);
    } catch {
      throw new Error('Could not reach the server. Is the backend running on port 8000?');
    }
    return parse<LearnerAuditResponse>(res);
  })();
  learnerAuditRequests.set(learnerId, request);
  request.then(
    () => learnerAuditRequests.delete(learnerId),
    () => learnerAuditRequests.delete(learnerId),
  );
  return request;
}

export interface AuditLearnersResponse {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  results: AuditLearnerSummary[];
  activityStats?: AuditActivityStats | null;
}

export async function fetchAuditLearnersPage(options: { search?: string; limit?: number; page?: number; pageSize?: number; includeTest?: boolean; includeAudit?: boolean; includeActivities?: boolean; activityCategory?: string } = {}): Promise<AuditLearnersResponse> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.includeTest) params.set('includeTest', 'true');
  if (options.includeAudit) params.set('includeAudit', 'true');
  if (options.includeActivities) params.set('includeActivities', 'true');
  if (options.activityCategory) params.set('activityCategory', options.activityCategory);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `${BASE}/${qs}`;
  const cachedRequest = learnerPageRequests.get(cacheKey);
  if (cachedRequest) return cachedRequest;
  let res: Response;
  const request = (async () => {
    try {
      res = await fetch(cacheKey);
    } catch {
      throw new Error('Could not reach the server. Is the backend running on port 8000?');
    }
    return parse<AuditLearnersResponse>(res);
  })();
  learnerPageRequests.set(cacheKey, request);
  request.then(
    () => learnerPageRequests.delete(cacheKey),
    () => learnerPageRequests.delete(cacheKey),
  );
  return request;
}

export async function fetchAuditLearners(options: { search?: string; limit?: number; includeTest?: boolean; includeAudit?: boolean; includeActivities?: boolean; activityCategory?: string } = {}): Promise<AuditLearnerSummary[]> {
  const data = await fetchAuditLearnersPage(options);
  return data.results;
}

export async function fetchAuditActivityStats(options: { search?: string; includeTest?: boolean } = {}): Promise<AuditActivityStats> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.includeTest) params.set('includeTest', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(`${BASE}/stats/${qs}`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parse<AuditActivityStats>(res);
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
  learnerAuditRequests.delete(learnerId);
  return parse<AuditSignoffResponse>(res);
}

export function auditBlobUrl(container: string, blob: string, filename?: string) {
  const params = new URLSearchParams({ container, blob });
  if (filename) params.set('filename', filename);
  return `/audit_api/blob/?${params.toString()}`;
}
