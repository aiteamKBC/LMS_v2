import { request } from './api';

export type MonitoredLearner = {
  enrolment_id: number; id: number; name: string; email: string; programme: string;
  enrolment_status: string; audit_status: string; coach_name: string | null; coach_email: string;
  status: string; needs_start: boolean; can_open: boolean; can_access_lms: boolean;
  total_months: number; completed_months: number; remaining_months: number;
  learner_signed_months: number; coach_signed_months: number;
  learner_unsigned_months: number; coach_unsigned_months: number;
  pending_revisions: number; ready_months: number; empty_months: number;
  activity_count: number; additional_months: number; first_outstanding_month: string | null;
  last_signed_at: string | null;
};
export type MonitoringData = {
  stats: Record<string, number>;
  learners: MonitoredLearner[]; total: number; page: number; page_size: number; pages: number;
  coaches: { key: string; name: string; learners: number; completed: number; outstanding_signatures: number }[];
  programmes: string[];
  monthly: { month: string; total: number; complete: number; learner_signed: number; coach_signed: number }[];
  updated_at: string; cutoff_date: string; scope: string; read_only: boolean;
};
export type MonitoringFilters = { page: number; search: string; status: string; coach?: string; programme: string };
export const getMonitoring = (filters: MonitoringFilters, signal?: AbortSignal) => {
  const params = new URLSearchParams({ page: String(filters.page), search: filters.search, status: filters.status, programme: filters.programme });
  if (filters.coach !== undefined) params.set('coach', filters.coach);
  return request<MonitoringData>(`/old-otjh/monitor/?${params}`, { signal });
};
