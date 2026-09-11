const BASE = '/api/progress-reviews';

export interface ProgressReviewActiveLearner {
  learnerId: number;
  fullName: string;
  email: string | null;
  programme: string | null;
  coach: string | null;
  cohort: string | null;
  group: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface ProgressReviewPeriod {
  review_number: number | null;
  review_date: string;
  review_period_start: string;
  review_period_end: string;
  action_period_start: string;
  action_period_end: string;
}

/** The progress_review_pack JSON, exactly as the spec defines it — every
 * section is either real, database-backed data or the literal string
 * "Not available"; nothing here is a guess. */
export interface ProgressReviewPack {
  learner: Record<string, unknown>;
  review: Record<string, unknown>;
  attendance: Record<string, unknown>;
  progress: Record<string, unknown>;
  otj: Record<string, unknown>;
  lms_modules: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  workplace_activities: Array<Record<string, unknown>>;
  ksbs: {
    knowledge_evidenced: Array<Record<string, unknown>>;
    skills_evidenced: Array<Record<string, unknown>>;
    behaviours_evidenced: Array<Record<string, unknown>>;
    priority_next: Array<Record<string, unknown>>;
  };
  epa: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  manager_questions: string[];
  source_warnings: string[];
}

export interface ProgressReviewGenerateResult {
  reviewId: string;
  learnerId: number;
  reviewNumber: number | null;
  reviewDate: string;
  reviewPeriodStart: string;
  reviewPeriodEnd: string;
  generationStatus: 'completed' | 'failed';
  sourceWarnings: string[];
  downloadUrl: string;
}

export interface ProgressReviewBulkResult {
  results: Array<
    | ProgressReviewGenerateResult
    | { learnerId: number; generationStatus: 'failed'; error: string }
  >;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parse<T>(res);
}

export async function fetchActiveLearners(): Promise<ProgressReviewActiveLearner[]> {
  const data = await request<{ results: ProgressReviewActiveLearner[] }>('/learners/active/');
  return data.results;
}

export async function fetchReviewPeriods(learnerId: number | string): Promise<ProgressReviewPeriod[]> {
  const data = await request<{ results: ProgressReviewPeriod[] }>(`/${learnerId}/periods/`);
  return data.results;
}

export async function fetchReviewPack(learnerId: number | string, reviewDate?: string): Promise<ProgressReviewPack> {
  const qs = reviewDate ? `?review_date=${encodeURIComponent(reviewDate)}` : '';
  return request<ProgressReviewPack>(`/${learnerId}/pack/${qs}`);
}

export async function generateProgressReview(
  learnerId: number | string,
  reviewDate?: string,
): Promise<ProgressReviewGenerateResult> {
  return request<ProgressReviewGenerateResult>(`/${learnerId}/generate/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reviewDate ? { review_date: reviewDate } : {}),
  });
}

export async function bulkGenerateProgressReviews(
  opts: { learnerIds?: Array<number | string>; reviewDate?: string } = {},
): Promise<ProgressReviewBulkResult> {
  const body: Record<string, unknown> = {};
  if (opts.learnerIds?.length) body.learner_ids = opts.learnerIds;
  if (opts.reviewDate) body.review_date = opts.reviewDate;
  return request<ProgressReviewBulkResult>('/bulk-generate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchProgressReviewDownloadUrl(reviewId: string): Promise<string> {
  const data = await request<{ url: string }>(`/${reviewId}/download/`);
  return data.url;
}
