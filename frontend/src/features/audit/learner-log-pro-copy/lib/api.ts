// The REAL (auditor-copy) workspace reads Audit.learner_match.programme_structure
// via the match-ledger endpoints, not the Audit.mre ledger the FAKE tab uses.
const API_URL = "/audit_api/match-ledger";

export type Ksb = {
  code: string;
  type: string;
  type_label: string;
  description: string | null;
  reason: string | null;
};

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
  week: string | null;
  ksbs: Ksb[];
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
  program_status: string;
  has_break_in_learning: boolean;
  coach: {
    name: string | null;
    email: string | null;
  };
};

export type LearnersResponse = {
  learners: LearnerSummary[];
  months: Array<{ number: number; label: string }>;
  categories: string[];
  periods: Array<{ value: string; label: string }>;
};

export type LearnerProfile = {
  id: string;
  aptem_id: string;
  name: string;
  email: string | null;
  programme: string;
  programme_status: string;
  break_in_learning: {
    has_break_in_learning: boolean;
    last_learning_date: string | null;
    expected_return_date: string | null;
    has_return_to_learning: boolean;
    return_to_learning_date: string | null;
    revised_learning_planned_end_date: string | null;
  };
  coach: {
    name: string | null;
    email: string | null;
  };
  planned_hours: number | null;
  learning_delivery: {
    learner_reference?: string;
    planned_hours?: number;
    actual_hours?: number | null;
    start_date?: string;
    first_evidence_date?: string | null;
    first_evidence_items?: Array<{
      id: string;
      name: string;
      component_name: string;
      kind: string;
      status: string;
      file: string | null;
      content: string | null;
      date: string;
    }>;
    planned_end_date?: string;
    completion_status?: number;
  };
  contracts: Array<{
    id: string;
    document_name: string;
    status: string;
    date: string | null;
    learner_signed_date: string | null;
    fully_signed_date: string | null;
    requested_date: string | null;
    programme: string | null;
    programme_start_date: string | null;
    planned_end_date: string | null;
    file: string | null;
  }>;
  training_plan: {
    total_modules: number;
    completed_modules: number;
    months: Array<{
      month: string;
      date: string | null;
      modules: Array<{ name: string; type: string; status: string }>;
    }>;
  };
  skills_radar: Array<{
    skill: string;
    knowledge: number | null;
    skill_score: number | null;
    behaviour: number | null;
    maximum: 8;
  }>;
  certifications: Array<{
    name: string;
    issuer?: string | null;
    issued_date?: string | null;
    expiry_date?: string | null;
    credential_id?: string | null;
    evidence_text?: string | null;
  }>;
  employment: {
    employer_name?: string | null;
    job_title?: string | null;
    workplace_address?: string | null;
    employment_start_date?: string | null;
    contracted_hours_per_week?: number | null;
    employment_type?: string | null;
    working_pattern?: string | null;
    line_manager?: { name?: string | null; email?: string | null; phone?: string | null; job_title?: string | null };
  } | null;
  programme_understanding: {
    understanding_programme: string | null;
    career_development_progression: string | null;
  };
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

export function getLearnerProfile(learnerId: string) {
  return getJson<LearnerProfile>(`/learner-profile?learner=${encodeURIComponent(learnerId)}`);
}
