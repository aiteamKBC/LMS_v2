import { coachFetch } from '@/lib/coachFetch';
import type {
  MonthlyReport,
  MonthlyReportAttachment,
  MonthlyReportKsb,
  MonthlyReportMetrics,
} from '@/api/monthlyReports';
import type { LearnerKind } from '@/api/learnerDetail';

const BASE = '/coach_api/coach/monthly-reports';

/** A report as it appears in the coach's table.
 *
 * Deliberately lighter than `MonthlyReport`: the signature (up to 400k chars)
 * and the activity snapshot (up to 2000 entries) are left out, since a
 * caseload's worth would be megabytes for a table that shows neither. The
 * detail request carries them when a coach opens one. */
export interface CoachMonthlyReportSummary {
  id: string;
  learnerKind: LearnerKind;
  learnerId: string;
  learnerName: string | null;
  programmeName: string | null;
  monthKey: string;
  monthLabel: string | null;
  status: string;
  learnedSummary: string;
  selectedKsbs: MonthlyReportKsb[];
  attachments: MonthlyReportAttachment[];
  summaryMetrics: MonthlyReportMetrics;
  /** Whether the learner signed it — not the signature itself. */
  signed: boolean;
  signedName: string;
  signedAt: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  activityCount: number;
}

export interface CoachMonthlyReportsResponse {
  items: CoachMonthlyReportSummary[];
  months: { monthKey: string; monthLabel: string | null }[];
  learners: { learnerId: string; learnerName: string | null }[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  summary: {
    reports: number;
    learners: number;
    attachments: number;
    unsigned: number;
  };
}

export interface CoachMonthlyReportFilters {
  month?: string;
  learner?: string;
  search?: string;
  page?: number;
  pageSize?: number;
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
    const body = data as { detail?: string; message?: string; error?: string } | null;
    throw new Error(
      body?.message || body?.detail || body?.error || `Request failed with ${res.status}`,
    );
  }
  return data as T;
}

/** Every monthly report submitted by the learners on this coach's caseload. */
export async function fetchCoachMonthlyReports(
  filters: CoachMonthlyReportFilters = {},
  signal?: AbortSignal,
): Promise<CoachMonthlyReportsResponse> {
  const params = new URLSearchParams();
  if (filters.month) params.set('month', filters.month);
  if (filters.learner) params.set('learner', filters.learner);
  if (filters.search) params.set('search', filters.search);
  params.set('page', String(filters.page || 1));
  params.set('pageSize', String(filters.pageSize || 25));
  const qs = params.toString() ? `?${params.toString()}` : '';

  let res: Response;
  try {
    res = await coachFetch(`${BASE}${qs}`, { cache: 'no-store', signal });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<Partial<CoachMonthlyReportsResponse>>(res);
  return {
    items: data.items || [],
    months: data.months || [],
    learners: data.learners || [],
    pagination: data.pagination || {
      page: 1,
      pageSize: filters.pageSize || 25,
      total: data.items?.length || 0,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    },
    summary: data.summary || {
      reports: data.items?.length || 0,
      learners: new Set((data.items || []).map((item) => item.learnerId)).size,
      attachments: (data.items || []).reduce((total, item) => total + item.attachments.length, 0),
      unsigned: (data.items || []).filter((item) => !item.signed).length,
    },
  };
}

/** One report in full — the reflection, activity record and signature. */
export async function fetchCoachMonthlyReport(reportId: string): Promise<MonthlyReport> {
  let res: Response;
  try {
    res = await coachFetch(`${BASE}/${reportId}`, { cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const data = await parse<{ item: MonthlyReport }>(res);
  return data.item;
}
