// The auditor-copy workspace now reads normalized learner/activity data from
// the LMS Django API backed by the `Last_audit` schema. The read endpoints are:
//
//   GET /audit_api/last-audit/cohort/               -> all matched LMS learners
//   GET /audit_api/last-audit/activities/?aptem_id= -> one learner's normalized results
//   GET /audit_api/last-audit/activity/?component_id= -> shared definition + participants
//
// This module preserves the existing UI types/signatures so the learner-search
// layout and route order stay stable. Last_audit does not yet contain mapped
// hours or occurrence dates, so unavailable values remain explicit.
//
// The two AUDITOR WRITE features the live (read-only) API does not cover — the
// per-activity annotation (planned-hours override + notes) and the monthly
// sign-off — stay pointed at the existing Django endpoints, which still own them.
// Read learner/activity data from the normalized Last_audit mirror through the
// LMS backend. Writes remain on the legacy service until the Last_audit write
// workflow is introduced explicitly; read rows are marked read-only below so a
// user cannot accidentally edit the old Audit source while viewing new data.
// Reads now come from the fetch-evidence backend (the deployed OTJH/Last_audit
// API), not the local /audit_api. Same endpoint contract (cohort / activities /
// activity / attendance-sheet / quiz-attempt), now enriched with per-activity
// planned + actual hours, reporting method and timestamps.
const READ_BASE = "https://fetch-evidence.kentbusinesscollege.net/api/last-audit-ledger";
const LEGACY_WRITE_BASE = "https://fetch-evidence.kentbusinesscollege.net/api/otjh";
const LAST_AUDIT_UNDATED_PERIOD = "undated";
// Django endpoint that still backs the auditor-entered activity annotations.
const ANNOTATION_BASE = "/audit_api/match-ledger";
const OVERLAY_URL = `${ANNOTATION_BASE}/activity-overrides`;

// ---------------------------------------------------------------------------
// Existing UI contract (unchanged) — every route imports from these types.
// ---------------------------------------------------------------------------

export type Ksb = {
  code: string;
  type: string;
  type_label: string;
  description: string | null;
  reason: string | null;
};

export type BundleComponent = {
  component_id: number | string | null;
  title: string;
  material_type: string;
  material_format: string | null;
  iframe_url: string | null;
  status: string | null;
  done: boolean;
  activity_date: string | null;
  planned_hours: number | null;
  time_spent_formatted: string | null;
  attempt_number: number | null;
  highest_score: number | null;
  score_percent: number | null;
  answered_questions: number | null;
  correct_answers: number | null;
  incorrect_answers: number | null;
  has_body: boolean;
};

export type QuizAnswerOption = {
  option_text: string;
  option_order: number;
  is_correct: boolean;
  is_selected: boolean;
};

export type QuizQuestion = {
  question_id: number;
  question_order: number;
  question_text: string;
  question_type: string;
  is_correct: boolean;
  answer_options: QuizAnswerOption[];
  correct_answers: string[];
  learner_selected_answers: string[];
};

export type QuizAttempt = {
  title: string;
  status: string;
  score: number | null;
  maximum_score: number | null;
  attempt_number: number;
  quiz_body: { description?: string | null; questions: QuizQuestion[] };
};

export type QuizAttemptResponse = {
  component_id: string;
  source_activity_id: number;
  aptem_id: number;
  is_quiz: boolean;
  state: "not_quiz" | "not_attempted" | "attempted";
  attempt: QuizAttempt | null;
};

export type LearnerActivity = {
  id: string;
  mre_id: string;
  learner: string;
  learner_id?: number;
  completed?: boolean;
  reading_completed?: boolean;
  quiz_attempted?: boolean;
  quiz_passed?: boolean;
  not_accepted?: boolean; // progress-review row → shown as "Accepted: No"
  azure_blob?: string | null;
  plan_id: string;
  month_no: number;
  month_unit: string;
  unit_planned_date: string;
  activity_date: string | null;
  learner_activity_date: string | null;
  activity_period: string | null;
  time_from_to: string | null;
  time_from: string | null;
  time_to: string | null;
  actual_lms_hours: number | null;
  activity_category: string;
  activity_unit: string;
  section_title: string | null;
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
  completion_records?: CompletionRecord[];
  components?: BundleComponent[];
  completed_count?: number;
  component_total?: number;
  source?: string;
  hours_mapped?: boolean;
};

export type CompletionRecord = {
  record_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  time_spent_seconds: number | null;
  time_spent_formatted: string | null;
};

export type OtjhMonth = {
  status: string;
  path?: string | null;
  flagged: boolean;
  applied_date?: string | null;
  note?: string | null;
  att_h?: number | null;
  asg_h?: number | null;
  lms_h?: number | null;
  unallocated_h?: number | null;
  computed_total_h?: number | null;
  aptem_actual_h?: number | null;
  n_media?: number | null;
  n_bundles?: number | null;
  n_reading_items?: number | null;
};

export type OtjhSummary = {
  adjusted: boolean;
  applied_date: string | null;
  note?: string | null;
  flagged_count: number;
  status_counts: Record<string, number>;
  band_target_h: number[] | null;
  band_correct_h: number[] | null;
  flagged_months: Array<{ date: string; month: string; status: string }>;
  month: OtjhMonth | null;
  month_flagged: boolean;
};

export type LearnerActivitiesResponse = {
  items: LearnerActivity[];
  total: number;
  planned_total: number;
  actual_total: number;
  limit: number;
  offset: number;
  otjh?: OtjhMonth | null;
};

export type LearnerSummary = {
  id: string;
  name: string;
  email: string | null;
  lms_id: number | null;
  declared_lms_id: number | null;
  lms_matched: boolean;
  programme: string;
  periods: Array<{ value: string; label: string }>;
  entries: number;
  planned_hours: number;
  planned_hours_available?: boolean;
  actual_hours: number;
  gap_hours: number;
  last_activity_date: string | null;
  program_status: string;
  has_break_in_learning: boolean;
  coach: {
    name: string | null;
    email: string | null;
  };
  // Progress-review hours that are NOT counted in actual_hours (shown separately).
  not_accepted_hours: number;
  // Data-quality flags from the live cohort feed (e.g. "withdrawn",
  // "no_attendance_recorded"). Surfaced as badges in the cohort table.
  flags: string[];
  hours_mapped?: boolean;
  activity_count?: number;
  programmes?: string[];
  otjh: OtjhSummary;
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
      modules: Array<{
        name: string;
        type: string;
        status: string;
        components: Record<string, unknown>;
        raw: Record<string, unknown>;
      }>;
      raw: Record<string, unknown>;
    }>;
    raw: Array<Record<string, unknown>>;
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

export type SessionRecording = {
  component_id: string;
  title: string;
  preview_url: string | null;
  week: string | null;
};

export type AttendanceSessionResponse = LearnerActivitiesResponse & {
  session: {
    date: string;
    group: string;
    group_label: string;
    module: string | null;
  } | null;
  recordings: SessionRecording[];
};

export type ActivityAnnotation = {
  component_id?: string;
  planned_hours: number | null;
  mapped_ksbs: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

// --- Activity Detail (the /activity/ + /edit/ endpoints) -------------------

// A sub-activity inside a reading+quiz bundle.
export type ActivityItem = {
  component_id: number | string;
  title: string;
  activity: string;
  material_type: string;
  iframe_url: string | null;
};

// One learner who has this activity/material.
export type ActivityParticipant = {
  learner_id: number;
  learner_name: string;
  found_as: string;
  activity: string;
  completed: boolean;
  reading_completed?: boolean;
  quiz_attempted?: boolean;
  quiz_passed?: boolean;
  actual: number | null;
  planned: number | null;
  month: string | null;
  date: string | null;
  timestamp_from: string | null;
  timestamp_to: string | null;
  timestamp_display: string;
  item_title: string | null;
};

export type ActivityDetail = {
  source?: string;
  component_id: number | string;
  programme?: string;
  programme_code?: string;
  activity: string;
  category: string;
  has_reading?: boolean;
  has_quiz?: boolean;
  participant_count: number;
  completed_count: number;
  reading_completed_count?: number;
  quiz_attempted_count?: number;
  quiz_completed_count?: number;
  items: ActivityItem[];
  item_count: number;
  participants: ActivityParticipant[];
};

function displayString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["front_end_name", "title", "name", "material_format", "content_type", "status"]) {
      if (typeof record[key] === "string" && record[key]) return record[key];
    }
  }
  return fallback;
}

export function normalizeActivityItem(value: unknown): ActivityItem {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = displayString(item.title, "Untitled activity");
  // The live API's richer projection now uses `activity` for completion/OTJH
  // metadata. Prefer its explicit front-end label and never pass that object to React.
  const activity = typeof item.activity === "string"
    ? item.activity
    : displayString(item.front_end_name, title);
  return {
    component_id: typeof item.component_id === "string" || typeof item.component_id === "number" ? item.component_id : "",
    title,
    activity,
    material_type: displayString(item.material_type, displayString(item.activity && typeof item.activity === "object" ? (item.activity as Record<string, unknown>).content_type : "", "activity")),
    iframe_url: typeof item.iframe_url === "string" && item.iframe_url ? item.iframe_url : null,
  };
}

function normalizeActivityDetail(detail: ActivityDetail): ActivityDetail {
  return {
    ...detail,
    activity: displayString(detail.activity, "Untitled activity"),
    category: displayString(detail.category, "activity"),
    items: Array.isArray(detail.items) ? detail.items.map(normalizeActivityItem) : [],
  };
}

// Only the server-whitelisted editable fields. Per-learner fields apply to the
// row identified by aptem_id; shared fields are activity-level and broadcast to
// every participant when apply_shared_to_all is true.
export type EditPatch = Partial<{
  // per-learner
  planned_hours: number;
  actual_hours: number;
  started_at: string; // ISO
  completed_at: string; // ISO
  journal: string;
  attended: boolean; // attendance only — server auto-sets 2.5/0 + timestamp
  // shared (activity-level)
  front_end_name: string;
  description: string;
  auditor_notes: string;
  ksb_notes: string;
  auditor_ksbs: string[];
  edited_by: string;
}>;

export type EditActivityResponse = {
  ok: boolean;
  changed: Record<string, unknown>;
  also_applied_to: number[];
};

// ---------------------------------------------------------------------------
// Live API response shapes (what fetch-evidence actually returns).
// ---------------------------------------------------------------------------

type LiveCohortMonth = {
  month: string;
  label: string;
  planned: number;
  actual: number;
  // Progress-review hours: planned is always 0 for these and they are kept OUT
  // of `actual` — shown separately as "not accepted".
  not_accepted: number;
  att_actual: number;
  asg_actual: number;
  media_actual: number;
  bundle_actual: number;
  unallocated_actual?: number;
};

type LiveCohortLearner = {
  aptem_id: number;
  learner_name: string;
  learner_email?: string | null;
  coach_name?: string | null;
  coach_email?: string | null;
  lms_id?: number | null;
  declared_lms_id?: number | null;
  lms_matched?: boolean;
  programme: string;
  programmes?: string[];
  withdrawn: boolean;
  programme_status?: string;
  planned_total: number;
  planned_hours_available?: boolean;
  actual_total: number;
  not_accepted_total: number;
  flags: string[];
  hours_mapped?: boolean;
  activity_count?: number;
  lms_activity_count?: number;
  attendance_count?: number;
  completed_count?: number;
  months: LiveCohortMonth[];
};

type LiveCohortResponse = {
  source?: string;
  programme?: string;
  programme_code?: string;
  programmes?: string[];
  learners: LiveCohortLearner[];
};

type LiveKsbItem = { code?: string | null; description?: string | null; [key: string]: unknown };
type LiveKsbs = { K?: LiveKsbItem[]; S?: LiveKsbItem[]; B?: LiveKsbItem[] } | null;

type LiveActivity = {
  activity_id: number | string;
  learner_id: number;
  learner_name: string;
  date: string | null;
  month: string;
  month_label: string;
  category: string;
  activity: string;
  activity_subtitle?: string | null;
  planned: number | null;
  actual: number;
  timestamp_from: string | null;
  timestamp_to: string | null;
  timestamp_display: string;
  completed: boolean;
  reading_viewed?: boolean | null;
  quiz_attempted?: boolean | null;
  quiz_passed?: boolean | null;
  has_reading?: boolean;
  has_quiz?: boolean;
  ksbs: LiveKsbs;
  iframe_url: string | null;
  not_accepted?: boolean; // progress-review rows
  azure_blob?: string | null;
  reporting_month?: string | null;
  reporting_week_index?: number | null;
  reporting_week_start?: string | null;
  reporting_week_end?: string | null;
  reporting_week_key?: string | null;
  reporting_week_label?: string | null;
  matched_attendance_date?: string | null;
  schedule_validation_status?: string | null;
  schedule_validation_flags?: string[];
  source?: string;
  hours_mapped?: boolean;
  mapped_seconds?: number | null;
};

type LiveActivitiesResponse = {
  aptem_id: number;
  learner_name: string;
  month: string | null;
  count: number;
  activities: LiveActivity[];
};

type ActivityOverlay = {
  aptem_id: number;
  activity_id: string;
  operation: "created" | "deleted" | "replaced";
  payload: LiveActivity;
  source_payload: LiveActivity | null;
  updated_by: string | null;
  updated_at: string | null;
};

type ActivityOverlayResponse = { items: ActivityOverlay[] };

export type ActivityRowInput = {
  date: string;
  category: string;
  activity: string;
  activity_subtitle?: string | null;
  planned: number;
  actual: number;
  timestamp_from?: string | null;
  timestamp_to?: string | null;
  timestamp_display?: string;
  completed?: boolean;
  not_accepted?: boolean;
  reporting_week_label?: string | null;
};

// The categories the activity feed uses (drives the "Category" filter).
const CATEGORIES = ["attendance", "video", "audio", "reading+quiz"];

// ---------------------------------------------------------------------------
// Low-level fetch + module-level caches.
// The cohort is fetched once per session (it is tiny + rarely changes). Each
// (learner, month) activity page is cached so the cohort table's activity
// counts and the activity-log tables share the same network calls.
// ---------------------------------------------------------------------------

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${READ_BASE}${path}`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

let overlayPromise: Promise<ActivityOverlay[]> | null = null;
async function fetchOverlays(): Promise<ActivityOverlay[]> {
  if (!overlayPromise) {
    overlayPromise = fetch(OVERLAY_URL)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? `Activity overlay request failed (${response.status})`);
        }
        return ((await response.json()) as ActivityOverlayResponse).items ?? [];
      })
      .catch((error) => {
        overlayPromise = null;
        throw error;
      });
  }
  return overlayPromise;
}

export function applyCohortOverlay(cohort: LiveCohortResponse, overlays: ActivityOverlay[]): LiveCohortResponse {
  const learners = cohort.learners.map((learner) => ({
    ...learner,
    months: learner.months.map((month) => ({ ...month })),
  }));
  const adjustments = overlays.flatMap((override) => {
    if (override.operation === "created") return [{ aptemId: override.aptem_id, activity: override.payload, direction: 1 }];
    if (override.operation === "replaced") return [
      ...(override.source_payload ? [{ aptemId: override.aptem_id, activity: override.source_payload, direction: -1 }] : []),
      { aptemId: override.aptem_id, activity: override.payload, direction: 1 },
    ];
    // Deleting an audit-created row replaces its `created` record and should
    // contribute zero. Deleting a live row subtracts its preserved snapshot.
    if (String(override.activity_id).startsWith("audit:")) return [];
    return [{ aptemId: override.aptem_id, activity: override.payload, direction: -1 }];
  });
  for (const { aptemId, activity, direction } of adjustments) {
    const learner = learners.find((item) => item.aptem_id === aptemId);
    if (!learner || !activity?.month) continue;
    let month = learner.months.find((item) => item.month === activity.month);
    if (!month && direction > 0) {
      month = {
        month: activity.month,
        label: activity.month_label,
        planned: 0,
        actual: 0,
        not_accepted: 0,
        att_actual: 0,
        asg_actual: 0,
        media_actual: 0,
        bundle_actual: 0,
      };
      learner.months.push(month);
    }
    if (!month) continue;
    const plannedDelta = direction * Number(activity.planned || 0);
    const actualDelta = direction * Number(activity.actual || 0);
    month.planned = round2(Math.max(0, month.planned + plannedDelta));
    learner.planned_total = round2(Math.max(0, learner.planned_total + plannedDelta));
    if (activity.not_accepted) {
      month.not_accepted = round2(Math.max(0, (month.not_accepted ?? 0) + actualDelta));
      learner.not_accepted_total = round2(Math.max(0, (learner.not_accepted_total ?? 0) + actualDelta));
      continue;
    }
    month.actual = round2(Math.max(0, month.actual + actualDelta));
    learner.actual_total = round2(Math.max(0, learner.actual_total + actualDelta));
    if (activity.category === "attendance") month.att_actual = round2(Math.max(0, month.att_actual + actualDelta));
    else if (activity.category === "assignment") month.asg_actual = round2(Math.max(0, month.asg_actual + actualDelta));
    else if (activity.category === "reading+quiz") month.bundle_actual = round2(Math.max(0, month.bundle_actual + actualDelta));
    else month.media_actual = round2(Math.max(0, month.media_actual + actualDelta));
  }
  for (const learner of learners) learner.months.sort((a, b) => a.month.localeCompare(b.month));
  return { ...cohort, learners };
}

let cohortPromise: Promise<LiveCohortResponse> | null = null;
function fetchCohort(): Promise<LiveCohortResponse> {
  if (!cohortPromise) {
    cohortPromise = Promise.all([
      getJson<LiveCohortResponse>("/cohort/"),
      fetchOverlays(),
    ]).then(([cohort, overlays]) => applyCohortOverlay(cohort, overlays))
      .catch((error) => {
      cohortPromise = null; // let a later call retry after a failure
      throw error;
    });
  }
  return cohortPromise;
}

const activityCache = new Map<string, Promise<LiveActivitiesResponse>>();
function fetchActivitiesRaw(aptemId: number, month?: string): Promise<LiveActivitiesResponse> {
  const key = `${aptemId}|${month ?? "all"}`;
  const cached = activityCache.get(key);
  if (cached) return cached;
  const query = new URLSearchParams({ aptem_id: String(aptemId) });
  if (month) query.set("month", month);
  const request = Promise.all([
    getJson<LiveActivitiesResponse>(`/activities/?${query}`),
    fetchOverlays(),
  ]).then(([response, overlays]) => {
    const relevant = overlays.filter((item) => item.aptem_id === aptemId);
    const byId = new Map(response.activities.map((activity) => [String(activity.activity_id), activity]));
    for (const override of relevant) {
      if (override.operation === "deleted") {
        byId.delete(String(override.activity_id));
      } else {
        byId.set(String(override.activity_id), override.payload);
      }
    }
    const activities = [...byId.values()].filter(
      (activity) => !month || activity.month === month,
    );
    return { ...response, count: activities.length, activities };
  })
    .catch((error) => {
      activityCache.delete(key);
      throw error;
    });
  activityCache.set(key, request);
  return request;
}

// ---------------------------------------------------------------------------
// Small mapping helpers.
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Resolve the `learner` route param (an aptem_id string OR a lower-cased name)
// to a live cohort learner.
function resolveLearner(cohort: LiveCohortResponse, learner: string): LiveCohortLearner | undefined {
  const normalized = learner.trim().replace(/^['"]|['"]$/g, "");
  const value = normalized.toLowerCase();
  return cohort.learners.find(
    (item) => String(item.aptem_id) === normalized || item.learner_name.toLowerCase() === value,
  );
}

function flattenKsbs(ksbs: LiveKsbs): Ksb[] {
  if (!ksbs) return [];
  const groups: Array<[keyof NonNullable<LiveKsbs>, string, string]> = [
    ["K", "K", "Knowledge"],
    ["S", "S", "Skill"],
    ["B", "B", "Behaviour"],
  ];
  const out: Ksb[] = [];
  for (const [key, type, label] of groups) {
    for (const item of ksbs[key] ?? []) {
      out.push({
        code: item.code ?? "",
        type,
        type_label: label,
        description: item.description ?? null,
        reason: null,
      });
    }
  }
  return out;
}

// One live activity row -> the LearnerActivity the tables/detail page consume.
function toActivity(a: LiveActivity): LearnerActivity {
  return {
    // Unique across a merged multi-learner set (activity_id alone can repeat).
    id: `${a.learner_id}:${a.activity_id}:${a.date ?? ""}:${a.category}`,
    mre_id: String(a.activity_id),
    learner: a.learner_name,
    learner_id: a.learner_id,
    completed: a.completed,
    reading_completed: a.reading_viewed === true,
    quiz_attempted: a.quiz_attempted === true,
    quiz_passed: a.quiz_passed === true,
    plan_id: String(a.activity_id),
    month_no: 0,
    month_unit: a.month_label,
    unit_planned_date: a.date ?? "",
    activity_date: a.date,
    learner_activity_date: a.date,
    activity_period: a.month, // "YYYY-MM" — powers the journal links
    // The Timestamp column is rendered EXACTLY from timestamp_display
    // (attended / not attended / input / HH:MM–HH:MM / empty).
    time_from_to: a.timestamp_display ?? "",
    time_from: a.timestamp_from,
    time_to: a.timestamp_to,
    actual_lms_hours: a.actual,
    activity_category: a.category,
    activity_unit: a.activity,
    section_title: null,
    activity_description: a.activity_subtitle ?? null,
    delivery_method: a.category,
    planned_hours: a.planned,
    source_course: null,
    source_url: a.iframe_url, // "Activity content" iframe on the detail page
    source_basis: null,
    created_at: null,
    configured_duration: null,
    week: a.reporting_week_label ?? null,
    ksbs: flattenKsbs(a.ksbs),
    completion_records: [],
    not_accepted: a.not_accepted === true,
    azure_blob: a.azure_blob ?? null,
    source: a.source,
    hours_mapped: a.hours_mapped,
  };
}

// A cohort month row -> the per-month OTJH breakdown the journal's OtjhCard shows.
// status is the on-track indicator derived from actual vs planned (the live feed
// has no engineered adjustment band, so nothing is "flagged" here).
function monthStatus(planned: number, actual: number): string {
  if (!planned && !actual) return "skipped_empty";
  if (planned > 0 && actual >= planned) return "happy";
  if (actual > planned) return "over_target";
  return "below_target";
}

function buildMonthOtjh(month: LiveCohortMonth): OtjhMonth {
  const lms = round2((month.media_actual ?? 0) + (month.bundle_actual ?? 0));
  const unallocated = round2(month.unallocated_actual ?? 0);
  const computed = round2(
    (month.att_actual ?? 0) + (month.asg_actual ?? 0) +
    (month.media_actual ?? 0) + (month.bundle_actual ?? 0) + unallocated,
  );
  return {
    status: monthStatus(month.planned, month.actual),
    flagged: unallocated > 0,
    att_h: month.att_actual,
    asg_h: month.asg_actual,
    lms_h: lms,
    unallocated_h: unallocated,
    computed_total_h: computed,
    aptem_actual_h: month.actual,
    n_media: null,
    n_bundles: null,
    n_reading_items: null,
    note: unallocated > 0
      ? "Aptem actual preserved as unallocated source time because no eligible completed activity was available for mapping."
      : null,
    applied_date: null,
    path: null,
  };
}

function buildPeriods(cohort: LiveCohortResponse): Array<{ value: string; label: string }> {
  const byMonth = new Map<string, string>();
  for (const learner of cohort.learners) {
    for (const month of learner.months) byMonth.set(month.month, month.label);
  }
  const periods = [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, label]) => ({ value, label }));
  if (cohort.source === "Last_audit" && cohort.learners.some(
    (learner) => (learner.lms_activity_count ?? (learner.months.length === 0 ? learner.activity_count : 0) ?? 0) > 0,
  )) {
    periods.push({ value: LAST_AUDIT_UNDATED_PERIOD, label: "Undated LMS activities" });
  }
  return periods;
}

// ---------------------------------------------------------------------------
// Public API — same signatures the routes already call.
// ---------------------------------------------------------------------------

export function getLearners(params: { period?: string; search?: string; position?: string; programme?: string; learner?: string } = {}) {
  return (async (): Promise<LearnersResponse> => {
    const cohort = await fetchCohort();
    const period = params.period;
    const search = (params.search ?? "").trim().toLowerCase();
    const position = params.position;
    const programme = (params.programme ?? "").trim().toLowerCase();
    const learnerFilter = (params.learner ?? "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();

    let rows = cohort.learners.map((learner) => {
      const month = period ? learner.months.find((item) => item.month === period) ?? null : null;
      const undated = period === LAST_AUDIT_UNDATED_PERIOD;
      const planned = period && !undated ? month?.planned ?? 0 : learner.planned_total;
      const actual = period && !undated ? month?.actual ?? 0 : learner.actual_total;
      const plannedAvailable = period
        ? cohort.source !== "Last_audit" && month != null
        : learner.planned_hours_available !== false;
      return { learner, month, planned, actual, plannedAvailable };
    });
    if (search) rows = rows.filter((row) => row.learner.learner_name.toLowerCase().includes(search));
    if (learnerFilter) rows = rows.filter(
      (row) => String(row.learner.aptem_id) === learnerFilter || row.learner.learner_name.toLowerCase() === learnerFilter,
    );
    if (programme) rows = rows.filter((row) =>
      (row.learner.programmes?.length ? row.learner.programmes : [row.learner.programme])
        .some((name) => name.toLowerCase() === programme),
    );
    if (position === "behind") rows = rows.filter(
      (row) => row.plannedAvailable && row.learner.hours_mapped !== false && row.actual - row.planned < 0,
    );
    if (position === "ahead") rows = rows.filter(
      (row) => row.plannedAvailable && row.learner.hours_mapped !== false && row.actual - row.planned >= 0,
    );

    const learners: LearnerSummary[] = rows.map(({ learner, month, planned, actual, plannedAvailable }) => {
      return {
        id: String(learner.aptem_id),
        name: learner.learner_name,
        email: learner.learner_email ?? null,
        lms_id: learner.lms_id ?? null,
        declared_lms_id: learner.declared_lms_id ?? null,
        lms_matched: learner.lms_matched === true,
        programme: learner.programme,
        periods: (learner.months
          .filter((item) =>
            Math.abs(Number(item.planned ?? 0)) > 0 ||
            Math.abs(Number(item.actual ?? 0)) > 0 ||
            Math.abs(Number(item.not_accepted ?? 0)) > 0,
          )
          .map((item) => ({ value: item.month, label: item.label }))
          .sort((left, right) => left.value.localeCompare(right.value)))
          .concat(
            (learner.lms_activity_count ?? (learner.months.length === 0 ? learner.activity_count : 0) ?? 0) > 0
              ? [{ value: LAST_AUDIT_UNDATED_PERIOD, label: "Undated LMS activities" }]
              : [],
          ),
        // This count is already aggregated by /cohort. Never fetch every
        // learner's /activities page just to populate the search table.
        entries: learner.activity_count ?? 0,
        planned_hours: round2(planned),
        planned_hours_available: plannedAvailable,
        actual_hours: round2(actual),
        gap_hours: round2(actual - planned),
        last_activity_date: null, // the cohort feed carries no last-activity date
        program_status: learner.programme_status ?? (learner.withdrawn ? "Withdrawn" : "Active"),
        has_break_in_learning: false,
        coach: {
          name: learner.coach_name ?? null,
          email: learner.coach_email ?? null,
        },
        not_accepted_hours: round2(
          period && period !== LAST_AUDIT_UNDATED_PERIOD
            ? month?.not_accepted ?? 0
            : learner.not_accepted_total ?? 0,
        ),
        flags: learner.flags ?? [],
        hours_mapped: learner.hours_mapped,
        activity_count: learner.activity_count,
        programmes: learner.programmes ?? [learner.programme],
        otjh: {
          adjusted: false,
          applied_date: null,
          note: null,
          // Data-quality flags are shown as their own badges; keep the OTJH
          // chip quiet so it does not double up on the same signal.
          flagged_count: 0,
          status_counts: {},
          band_target_h: null,
          band_correct_h: null,
          flagged_months: [],
          month: month ? buildMonthOtjh(month) : null,
          month_flagged: false,
        },
      };
    });

    return {
      learners,
      months: buildPeriods(cohort).map((period, index) => ({ number: index + 1, label: period.label })),
      categories: CATEGORIES,
      periods: buildPeriods(cohort),
    };
  })();
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
  programme?: string;
}) {
  return (async (): Promise<LearnerActivitiesResponse> => {
    const cohort = await fetchCohort();
    const month = params.period || undefined; // "YYYY-MM"; the numeric `month` param is unused by callers

    // Which learners' activities to pull: one resolved learner, or the whole cohort.
    let targets: LiveCohortLearner[];
    let single: LiveCohortLearner | undefined;
    const programme = (params.programme ?? "").trim().toLowerCase();
    const eligibleLearners = programme
      ? cohort.learners.filter((learner) =>
          (learner.programmes?.length ? learner.programmes : [learner.programme])
            .some((name) => name.toLowerCase() === programme),
        )
      : cohort.learners;
    if (params.learner) {
      single = resolveLearner(cohort, params.learner);
      targets = single && eligibleLearners.some((learner) => learner.aptem_id === single!.aptem_id) ? [single] : [];
    } else {
      // Last_audit can contain thousands of rows per learner. Never fan out 520
      // browser requests when a route has not selected one learner; cohort
      // counts already come from the server and activity detail has its own
      // set-based endpoint.
      if (cohort.source === "Last_audit") {
        return {
          items: [],
          total: 0,
          planned_total: 0,
          actual_total: 0,
          limit: params.limit,
          offset: params.offset,
          otjh: null,
        };
      }
      targets = eligibleLearners;
    }

    const pages = await Promise.all(
      targets.map((learner) =>
        fetchActivitiesRaw(learner.aptem_id, month).catch(() => ({ activities: [] } as Partial<LiveActivitiesResponse>)),
      ),
    );
    let items = pages.flatMap((page) => (page.activities ?? []).map(toActivity));

    const searchTerm = (params.search ?? "").trim().toLowerCase();
    if (searchTerm) {
      items = items.filter(
        (item) =>
          item.plan_id.toLowerCase().includes(searchTerm) ||
          item.activity_unit.toLowerCase().includes(searchTerm) ||
          item.learner.toLowerCase().includes(searchTerm),
      );
    }
    if (params.category) items = items.filter((item) => item.activity_category === params.category);

    // Chronological, then by learner, for a stable audit log.
    items.sort((left, right) => {
      const byDate = (left.activity_date ?? "").localeCompare(right.activity_date ?? "");
      return byDate !== 0 ? byDate : left.learner.localeCompare(right.learner);
    });

    const total = items.length;
    const plannedTotal = round2(items.reduce((sum, item) => sum + (item.planned_hours ?? 0), 0));
    const actualTotal = round2(items.reduce((sum, item) => sum + (item.actual_lms_hours ?? 0), 0));
    const paged = items.slice(params.offset, params.offset + params.limit);

    // Per-month OTJH breakdown for the journal (single learner + single month).
    let otjh: OtjhMonth | null = null;
    if (single && month) {
      const monthRow = single.months.find((item) => item.month === month);
      if (monthRow) otjh = buildMonthOtjh(monthRow);
    }

    return {
      items: paged,
      total,
      planned_total: plannedTotal,
      actual_total: actualTotal,
      limit: params.limit,
      offset: params.offset,
      otjh,
    };
  })();
}

// All learners who have this activity id, one row each (activity-detail drill-down).
export function getActivityLearners(params: { component: string; search?: string; programme?: string }) {
  return (async (): Promise<LearnerActivitiesResponse> => {
    // /activity performs one set-based database query and returns all
    // participants. Do not scan /activities once for every learner.
    const detail = normalizeActivityDetail(
      await getJson<ActivityDetail>(`/activity/?component_id=${encodeURIComponent(params.component)}`),
    );
    let items = detail.participants.map((participant): LearnerActivity => ({
      id: `${participant.learner_id}:${detail.component_id}`,
      mre_id: String(detail.component_id),
      learner: participant.learner_name,
      learner_id: participant.learner_id,
      completed: participant.completed,
      reading_completed: participant.reading_completed === true,
      quiz_attempted: participant.quiz_attempted === true,
      quiz_passed: participant.quiz_passed === true,
      plan_id: String(detail.component_id),
      month_no: 0,
      month_unit: participant.month ?? "Undated",
      unit_planned_date: participant.date ?? "",
      activity_date: participant.date,
      learner_activity_date: participant.date,
      activity_period: participant.month,
      time_from_to: participant.timestamp_display ?? "",
      time_from: participant.timestamp_from,
      time_to: participant.timestamp_to,
      actual_lms_hours: participant.actual,
      activity_category: detail.category,
      activity_unit: participant.activity || detail.activity,
      section_title: null,
      activity_description: null,
      delivery_method: detail.category,
      planned_hours: participant.planned,
      source_course: null,
      source_url: null,
      source_basis: null,
      created_at: null,
      configured_duration: null,
      week: null,
      ksbs: [],
      completion_records: [],
      source: detail.source,
      hours_mapped: participant.actual != null,
    }));
    const searchTerm = (params.search ?? "").trim().toLowerCase();
    if (searchTerm) items = items.filter((item) => item.learner.toLowerCase().includes(searchTerm));

    return {
      items,
      total: items.length,
      planned_total: round2(items.reduce((sum, item) => sum + (item.planned_hours ?? 0), 0)),
      actual_total: round2(items.reduce((sum, item) => sum + (item.actual_lms_hours ?? 0), 0)),
      limit: items.length,
      offset: 0,
      otjh: null,
    };
  })();
}

// The live feed has no live-session/recordings concept, so we reconstruct the
// "session" as every attendance row that shares the same activity name + date
// (the key is the reference activity id). No recordings are available.
export function getAttendanceSession(key: string, programme?: string) {
  return (async (): Promise<AttendanceSessionResponse> => {
    const result = await getActivityLearners({ component: key, programme });
    const items = result.items.filter((item) => item.activity_category === "attendance");
    const reference = items[0];

    return {
      items,
      total: items.length,
      planned_total: round2(items.reduce((sum, item) => sum + (item.planned_hours ?? 0), 0)),
      actual_total: round2(items.reduce((sum, item) => sum + (item.actual_lms_hours ?? 0), 0)),
      limit: items.length,
      offset: 0,
      otjh: null,
      session: reference
        ? {
            date: reference.activity_date ?? "",
            group: reference.activity_unit,
            group_label: reference.activity_unit,
            module: null,
          }
        : null,
      recordings: [],
    };
  })();
}

// One learner's graded quiz body, read by Aptem identity from Last_audit. The
// backend merges activities.quiz_questions with activity_results.quiz_answers.
export function getQuizAttempt(params: { aptemId: number; component: string }) {
  return (async (): Promise<QuizAttemptResponse> => {
    const query = new URLSearchParams({
      aptem_id: String(params.aptemId),
      component_id: params.component,
    });
    const response = await fetch(`${READ_BASE}/quiz-attempt/?${query}`);
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<QuizAttemptResponse>;
  })();
}

export function getLearnerProfile(learnerId: string) {
  return (async (): Promise<LearnerProfile> => {
    // The endpoint resolves every learner from the Aptem-first Last_audit cohort
    // and joins the rich profile sources by that learner's Aptem ID.
    const query = new URLSearchParams({ learner: learnerId.replace(/^"|"$/g, "") });
    const response = await fetch(`${ANNOTATION_BASE}/learner-profile?${query}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Could not load learner profile (${response.status})`);
    }
    return response.json() as Promise<LearnerProfile>;
  })();
}

// ---------------------------------------------------------------------------
// Auditor annotations — still owned by the Django match-ledger backend, since
// the live evidence API is read-only and does not store auditor input.
// ---------------------------------------------------------------------------

export function getActivityAnnotation(component: string) {
  return (async (): Promise<ActivityAnnotation> => {
    const response = await fetch(
      `${ANNOTATION_BASE}/activity-annotation?component=${encodeURIComponent(component)}`,
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<ActivityAnnotation>;
  })();
}

export async function saveActivityAnnotation(payload: {
  component_id: string;
  planned_hours: number | null;
  mapped_ksbs: string | null;
  updated_by?: string | null;
}): Promise<ActivityAnnotation> {
  const response = await fetch(`${ANNOTATION_BASE}/activity-annotation/save`, {
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

// ---------------------------------------------------------------------------
// Activity Detail — live from the evidence API. GET returns the activity, its
// sub-activities (bundle items) and every participant; POST edits whitelisted
// fields. Both are read/write on the live service (CORS + preflight handled).
// ---------------------------------------------------------------------------

export async function getActivityDetail(componentId: string | number, learnerId?: string): Promise<ActivityDetail> {
  const cohort = await fetchCohort();
  const referenceLearner = learnerId ? resolveLearner(cohort, learnerId) : undefined;
  const programme = referenceLearner?.programme;
  const programmeQuery = programme ? `&programme=${encodeURIComponent(programme)}` : "";
  try {
    const detail = normalizeActivityDetail(
      await getJson<ActivityDetail>(`/activity/?component_id=${encodeURIComponent(String(componentId))}${programmeQuery}`),
    );
    if (detail.source === "Last_audit") return detail;
    const merged = await getActivityLearners({ component: String(componentId), programme });
    if (!merged.items.length) throw new Error("This activity has been deleted from the audit view.");
    const participants: ActivityParticipant[] = merged.items.map((row) => ({
      learner_id: row.learner_id ?? 0,
      learner_name: row.learner,
      found_as: row.activity_category,
      activity: row.activity_unit,
      completed: Boolean(row.completed),
      actual: row.actual_lms_hours,
      planned: row.planned_hours,
      month: row.activity_period,
      date: row.activity_date,
      timestamp_from: row.time_from,
      timestamp_to: row.time_to,
      timestamp_display: row.time_from_to ?? "",
      item_title: null,
    }));
    return {
      ...detail,
      activity: merged.items[0].activity_unit,
      category: merged.items[0].activity_category,
      participant_count: participants.length,
      completed_count: participants.filter((participant) => participant.completed).length,
      participants,
    };
  } catch (error) {
    // The /activity endpoint only resolves component-based items (video, audio,
    // reading+quiz bundles, attendance). Assignments use a separate id namespace
    // and 404 there — but /edit DOES accept them. Reconstruct a minimal detail
    // from the flat activities feed so assignment rows still open and stay editable.
    const learners = await getActivityLearners({ component: String(componentId), programme });
    if (!learners.items.length) throw error; // genuinely unknown id
    const participants: ActivityParticipant[] = learners.items.map((row) => ({
      learner_id: row.learner_id ?? 0,
      learner_name: row.learner,
      found_as: row.activity_category,
      activity: row.activity_unit,
      completed: Boolean(row.completed),
      actual: row.actual_lms_hours,
      planned: row.planned_hours,
      month: row.activity_period,
      date: row.activity_date,
      timestamp_from: row.time_from,
      timestamp_to: row.time_to,
      timestamp_display: row.time_from_to ?? "",
      item_title: null,
    }));
    const first = learners.items[0];
    return {
      component_id: componentId,
      programme,
      activity: first.activity_unit,
      category: first.activity_category,
      participant_count: participants.length,
      completed_count: participants.filter((p) => p.completed).length,
      items: [],
      item_count: 0,
      participants,
    };
  }
}

export async function editActivity(payload: {
  aptem_id: number;
  component_id: number | string;
  patch: EditPatch;
  apply_shared_to_all?: boolean;
}): Promise<EditActivityResponse> {
  if (String(payload.component_id).startsWith("la:")) {
    throw new Error("Last_audit activities are read-only until the hours/edit mapping step is enabled.");
  }
  const response = await fetch(`${LEGACY_WRITE_BASE}/edit/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aptem_id: payload.aptem_id,
      component_id: payload.component_id,
      patch: payload.patch,
      apply_shared_to_all: payload.apply_shared_to_all ?? false,
    }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string; editable?: string[] } | null;
    const allowed = error?.editable ? ` (allowed: ${error.editable.join(", ")})` : "";
    throw new Error((error?.error ?? `Edit failed (${response.status})`) + allowed);
  }
  return response.json() as Promise<EditActivityResponse>;
}

async function overlayMutation(method: "POST" | "PUT" | "PATCH" | "DELETE", body: Record<string, unknown>) {
  const response = await fetch(OVERLAY_URL, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Activity ${method.toLowerCase()} failed (${response.status})`);
  }
  invalidateOtjhCaches();
  return response.json() as Promise<{ ok: boolean; activity_id: string; payload: LiveActivity }>;
}

function rowSnapshot(row: LearnerActivity): ActivityRowInput {
  return {
    date: row.activity_date ?? row.learner_activity_date ?? "",
    category: row.activity_category,
    activity: row.activity_unit,
    activity_subtitle: row.activity_description,
    planned: row.planned_hours ?? 0,
    actual: row.actual_lms_hours ?? 0,
    timestamp_from: row.time_from,
    timestamp_to: row.time_to,
    timestamp_display: row.time_from_to ?? "",
    completed: Boolean(row.completed),
    not_accepted: Boolean(row.not_accepted),
    reporting_week_label: row.week,
  };
}

export async function createActivity(aptemId: number, activity: ActivityRowInput, updatedBy?: string) {
  return overlayMutation("POST", { aptem_id: aptemId, activity, updated_by: updatedBy });
}

export async function updateActivityRow(row: LearnerActivity, activity: ActivityRowInput, updatedBy?: string) {
  const aptemId = row.learner_id;
  if (!aptemId) throw new Error("The learner ID is missing from this activity.");
  if (row.plan_id.startsWith("audit:")) {
    return overlayMutation("PATCH", {
      aptem_id: aptemId,
      activity_id: row.plan_id,
      patch: activity,
      updated_by: updatedBy,
    });
  }

  const current = rowSnapshot(row);
  // Last_audit is an immutable source mirror.  Every edit is stored as a
  // reversible replacement overlay, even when the date itself is unchanged.
  if (row.source === "Last_audit" || row.plan_id.startsWith("la:") || activity.date !== current.date) {
    return overlayMutation("PUT", {
      aptem_id: aptemId,
      activity_id: row.plan_id,
      activity,
      snapshot: current,
      updated_by: updatedBy,
    });
  }
  const patch: EditPatch = {};
  if (activity.activity !== current.activity) patch.front_end_name = activity.activity;
  if (activity.planned !== current.planned) patch.planned_hours = activity.planned;
  if (activity.category === "attendance") {
    if ((activity.actual > 0) !== Boolean(row.completed)) patch.attended = activity.actual > 0;
  } else if (activity.actual !== current.actual) patch.actual_hours = activity.actual;
  if (activity.timestamp_from && activity.timestamp_from !== current.timestamp_from) patch.started_at = activity.timestamp_from;
  if (activity.timestamp_to && activity.timestamp_to !== current.timestamp_to) patch.completed_at = activity.timestamp_to;
  if (Object.keys(patch).length === 0) return { ok: true, changed: {}, also_applied_to: [] };
  const result = await editActivity({ aptem_id: aptemId, component_id: row.plan_id, patch });
  invalidateOtjhCaches();
  return result;
}

export async function deleteActivityRow(row: LearnerActivity, updatedBy?: string) {
  if (!row.learner_id) throw new Error("The learner ID is missing from this activity.");
  return overlayMutation("DELETE", {
    aptem_id: row.learner_id,
    activity_id: row.plan_id,
    snapshot: rowSnapshot(row),
    updated_by: updatedBy,
  });
}

// After an edit, reset the module-level read caches so react-query refetches
// pull fresh data (the server busts its own cache too).
export function invalidateOtjhCaches() {
  cohortPromise = null;
  overlayPromise = null;
  activityCache.clear();
}
