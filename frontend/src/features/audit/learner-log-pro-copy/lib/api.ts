// The REAL (auditor-copy) workspace reads Audit.learner_match.programme_structure
// via the match-ledger endpoints, not the Audit.mre ledger the FAKE tab uses.
const API_URL = "/audit_api/match-ledger";

export type LearnerActivity = {
  id: string;
  mre_id: string;
  learner: string;
  plan_id: string;
  month_no: number;
  month_unit: string;
  unit_planned_date: string;
  activity_date: string | null;
  learner_activity_date: string | null;
  activity_period: string | null;
  time_from_to: string | null;
  actual_lms_hours: number | null;
  activity_category: string;
  activity_unit: string;
  activity_description: string | null;
  delivery_method: string;
  planned_hours: number | null;
  source_course: string | null;
  source_url: string | null;
  source_basis: string | null;
  created_at: string | null;
  configured_duration: string | null;
};

export type LearnerActivitiesResponse = {
  items: LearnerActivity[];
  total: number;
  planned_total: number;
  actual_total: number;
  limit: number;
  offset: number;
};

export type LearnerSummary = {
  id: string;
  name: string;
  entries: number;
  planned_hours: number;
  actual_hours: number;
  gap_hours: number;
  last_activity_date: string | null;
};

export type LearnersResponse = {
  learners: LearnerSummary[];
  months: Array<{ number: number; label: string }>;
  categories: string[];
  periods: Array<{ value: string; label: string }>;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getLearnerActivities(params: {
  search: string;
  offset: number;
  limit: number;
  learner?: string;
  learnerSearch?: string;
  month?: number;
  category?: string;
  period?: string;
}) {
  const query = new URLSearchParams({
    search: params.search,
    offset: String(params.offset),
    limit: String(params.limit),
  });
  if (params.learner) query.set("learner", params.learner);
  if (params.learnerSearch) query.set("learner_search", params.learnerSearch);
  if (params.month) query.set("month", String(params.month));
  if (params.category) query.set("category", params.category);
  if (params.period) query.set("period", params.period);
  return getJson<LearnerActivitiesResponse>(`/learner-activities?${query}`);
}

export function getActivityLearners(params: { component: string; search?: string }) {
  const query = new URLSearchParams({ component: params.component });
  if (params.search) query.set("search", params.search);
  return getJson<LearnerActivitiesResponse>(`/activity-learners?${query}`);
}

export type ActivityAnnotation = {
  component_id?: string;
  planned_hours: number | null;
  mapped_ksbs: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

export function getActivityAnnotation(component: string) {
  return getJson<ActivityAnnotation>(`/activity-annotation?component=${encodeURIComponent(component)}`);
}

export async function saveActivityAnnotation(payload: {
  component_id: string;
  planned_hours: number | null;
  mapped_ksbs: string | null;
  updated_by?: string | null;
}): Promise<ActivityAnnotation> {
  const response = await fetch(`${API_URL}/activity-annotation/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Save failed (${response.status})`);
  }
  return response.json() as Promise<ActivityAnnotation>;
}

export function getLearners(params: { period?: string; search?: string; position?: string } = {}) {
  const query = new URLSearchParams();
  if (params.period) query.set("period", params.period);
  if (params.search) query.set("search", params.search);
  if (params.position) query.set("position", params.position);
  const suffix = query.size ? `?${query}` : "";
  return getJson<LearnersResponse>(`/learners${suffix}`);
}
