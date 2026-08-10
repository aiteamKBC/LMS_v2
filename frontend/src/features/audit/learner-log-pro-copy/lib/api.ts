// The REAL (auditor-copy) workspace now reads its OTJH planned-vs-actual data
// straight from the live, pre-flattened + server-cached evidence API rather than
// the local Django match-ledger endpoints. The two live endpoints are:
//
//   GET /api/otjh/cohort/                          -> the 6 PCP learners, totals + monthly split + flags
//   GET /api/otjh/activities/?aptem_id=&month=     -> one learner's (optionally one month's) evidence rows
//
// CORS is open on the deployed service, so the browser calls it directly. This
// module keeps the SAME exported types + function signatures the routes already
// consume, and maps the live responses into that existing contract — so the UI
// (search / journal / activity / learner-profile views) is untouched.
//
// The two AUDITOR WRITE features the live (read-only) API does not cover — the
// per-activity annotation (planned-hours override + notes) and the monthly
// sign-off — stay pointed at the existing Django endpoints, which still own them.
const BASE = "https://fetch-evidence.kentbusinesscollege.net/api/otjh";
// Django endpoint that still backs the auditor-entered activity annotations.
const ANNOTATION_BASE = "/audit_api/match-ledger";

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
  quiz_body: { questions: QuizQuestion[] };
};

export type QuizAttemptResponse = {
  component_id: string;
  attempt: QuizAttempt | null;
};

export type LearnerActivity = {
  id: string;
  mre_id: string;
  learner: string;
  learner_id?: number;
  completed?: boolean;
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
  // Progress-review hours that are NOT counted in actual_hours (shown separately).
  not_accepted_hours: number;
  // Data-quality flags from the live cohort feed (e.g. "withdrawn",
  // "no_attendance_recorded"). Surfaced as badges in the cohort table.
  flags: string[];
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
  actual: number | null;
  planned: number | null;
  month: string | null;
  date: string | null;
  timestamp_display: string;
  item_title: string | null;
};

export type ActivityDetail = {
  component_id: number | string;
  activity: string;
  category: string;
  participant_count: number;
  completed_count: number;
  items: ActivityItem[];
  item_count: number;
  participants: ActivityParticipant[];
};

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
  programme: string;
  withdrawn: boolean;
  planned_total: number;
  actual_total: number;
  not_accepted_total: number;
  flags: string[];
  months: LiveCohortMonth[];
};

type LiveCohortResponse = { learners: LiveCohortLearner[] };

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
  planned: number;
  actual: number;
  timestamp_from: string | null;
  timestamp_to: string | null;
  timestamp_display: string;
  completed: boolean;
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
};

type LiveActivitiesResponse = {
  aptem_id: number;
  learner_name: string;
  month: string | null;
  count: number;
  activities: LiveActivity[];
};

// The categories the activity feed uses (drives the "Category" filter).
const CATEGORIES = ["attendance", "assignment", "video", "audio", "reading+quiz", "progress review"];

// ---------------------------------------------------------------------------
// Low-level fetch + module-level caches.
// The cohort is fetched once per session (it is tiny + rarely changes). Each
// (learner, month) activity page is cached so the cohort table's activity
// counts and the activity-log tables share the same network calls.
// ---------------------------------------------------------------------------

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

let cohortPromise: Promise<LiveCohortResponse> | null = null;
function fetchCohort(): Promise<LiveCohortResponse> {
  if (!cohortPromise) {
    cohortPromise = getJson<LiveCohortResponse>("/cohort/").catch((error) => {
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
  const request = getJson<LiveActivitiesResponse>(`/activities/?${query}`).catch((error) => {
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
  const value = learner.trim().toLowerCase();
  return cohort.learners.find(
    (item) => String(item.aptem_id) === learner.trim() || item.learner_name.toLowerCase() === value,
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
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, label]) => ({ value, label }));
}

// ---------------------------------------------------------------------------
// Public API — same signatures the routes already call.
// ---------------------------------------------------------------------------

export function getLearners(params: { period?: string; search?: string; position?: string } = {}) {
  return (async (): Promise<LearnersResponse> => {
    const cohort = await fetchCohort();
    const period = params.period;
    const search = (params.search ?? "").trim().toLowerCase();
    const position = params.position;

    let rows = cohort.learners.map((learner) => {
      const month = period ? learner.months.find((item) => item.month === period) ?? null : null;
      const planned = period ? month?.planned ?? 0 : learner.planned_total;
      const actual = period ? month?.actual ?? 0 : learner.actual_total;
      return { learner, month, planned, actual };
    });
    if (search) rows = rows.filter((row) => row.learner.learner_name.toLowerCase().includes(search));
    if (position === "behind") rows = rows.filter((row) => row.actual - row.planned < 0);
    if (position === "ahead") rows = rows.filter((row) => row.actual - row.planned >= 0);

    // Accurate per-learner activity counts only when a month is selected: those
    // month pages are small (~50-80KB) and are the SAME pages the activity log
    // fetches, so they cost no extra network. The rarely-used "All months"
    // cohort view skips the (potentially large) all-activities fan-out.
    let counts: Record<string, number> = {};
    if (period) {
      const resolved = await Promise.all(
        rows.map(async (row) => {
          try {
            const raw = await fetchActivitiesRaw(row.learner.aptem_id, period);
            return [String(row.learner.aptem_id), raw.count ?? raw.activities.length] as const;
          } catch {
            return [String(row.learner.aptem_id), 0] as const;
          }
        }),
      );
      counts = Object.fromEntries(resolved);
    }

    const learners: LearnerSummary[] = rows.map(({ learner, month, planned, actual }) => {
      return {
        id: String(learner.aptem_id),
        name: learner.learner_name,
        entries: counts[String(learner.aptem_id)] ?? 0,
        planned_hours: round2(planned),
        actual_hours: round2(actual),
        gap_hours: round2(actual - planned),
        last_activity_date: null, // the cohort feed carries no last-activity date
        program_status: learner.withdrawn ? "Withdrawn" : "Active",
        has_break_in_learning: false,
        coach: { name: null, email: null },
        not_accepted_hours: round2(period ? month?.not_accepted ?? 0 : learner.not_accepted_total ?? 0),
        flags: learner.flags ?? [],
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
}) {
  return (async (): Promise<LearnerActivitiesResponse> => {
    const cohort = await fetchCohort();
    const month = params.period || undefined; // "YYYY-MM"; the numeric `month` param is unused by callers

    // Which learners' activities to pull: one resolved learner, or the whole cohort.
    let targets: LiveCohortLearner[];
    let single: LiveCohortLearner | undefined;
    if (params.learner) {
      single = resolveLearner(cohort, params.learner);
      targets = single ? [single] : [];
    } else {
      targets = cohort.learners;
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
export function getActivityLearners(params: { component: string; search?: string }) {
  return (async (): Promise<LearnerActivitiesResponse> => {
    const cohort = await fetchCohort();
    const pages = await Promise.all(
      cohort.learners.map((learner) =>
        fetchActivitiesRaw(learner.aptem_id).catch(() => ({ activities: [] } as Partial<LiveActivitiesResponse>)),
      ),
    );
    let items = pages
      .flatMap((page) => (page.activities ?? []).map(toActivity))
      .filter((item) => item.plan_id === String(params.component));
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
export function getAttendanceSession(key: string) {
  return (async (): Promise<AttendanceSessionResponse> => {
    const cohort = await fetchCohort();
    const pages = await Promise.all(
      cohort.learners.map((learner) =>
        fetchActivitiesRaw(learner.aptem_id).catch(() => ({ activities: [] } as Partial<LiveActivitiesResponse>)),
      ),
    );
    const all = pages.flatMap((page) => (page.activities ?? []).map(toActivity));
    const reference = all.find((item) => item.plan_id === String(key));
    const items = reference
      ? all.filter(
          (item) =>
            item.activity_category === "attendance" &&
            item.activity_unit === reference.activity_unit &&
            item.activity_date === reference.activity_date,
        )
      : [];

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

// One learner's graded quiz body. The live evidence feed does not expose graded
// quiz bodies, so this read stays pointed at the Django match-ledger endpoint
// (which reads the Audit.learner_match.quiz_attempts jsonb column) — the same
// backend that still owns the auditor annotations below.
export function getQuizAttempt(params: { learner: string; component: string }) {
  return (async (): Promise<QuizAttemptResponse> => {
    const query = new URLSearchParams({ learner: params.learner, component: params.component });
    const response = await fetch(`${ANNOTATION_BASE}/quiz-attempt?${query}`);
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<QuizAttemptResponse>;
  })();
}

export function getLearnerProfile(learnerId: string) {
  return (async (): Promise<LearnerProfile> => {
    const cohort = await fetchCohort();
    const learner = resolveLearner(cohort, learnerId);
    if (!learner) throw new Error(`no PCP learner ${learnerId}`);
    // The live cohort feed only carries OTJH-relevant fields; the richer profile
    // sections (radar, contracts, certifications, employer, training plan) have
    // no source here and render as the page's own empty states.
    return {
      id: String(learner.aptem_id),
      aptem_id: String(learner.aptem_id),
      name: learner.learner_name,
      email: null,
      programme: learner.programme,
      programme_status: learner.withdrawn ? "Withdrawn" : "Active",
      break_in_learning: {
        has_break_in_learning: false,
        last_learning_date: null,
        expected_return_date: null,
        has_return_to_learning: false,
        return_to_learning_date: null,
        revised_learning_planned_end_date: null,
      },
      coach: { name: null, email: null },
      planned_hours: learner.planned_total,
      learning_delivery: {
        planned_hours: learner.planned_total,
        actual_hours: learner.actual_total,
        first_evidence_date: null,
        first_evidence_items: [],
      },
      contracts: [],
      training_plan: { total_modules: 0, completed_modules: 0, months: [] },
      skills_radar: [],
      certifications: [],
      employment: null,
      programme_understanding: { understanding_programme: null, career_development_progression: null },
    };
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

export async function getActivityDetail(componentId: string | number): Promise<ActivityDetail> {
  try {
    return await getJson<ActivityDetail>(`/activity/?component_id=${encodeURIComponent(String(componentId))}`);
  } catch (error) {
    // The /activity endpoint only resolves component-based items (video, audio,
    // reading+quiz bundles, attendance). Assignments use a separate id namespace
    // and 404 there — but /edit DOES accept them. Reconstruct a minimal detail
    // from the flat activities feed so assignment rows still open and stay editable.
    const learners = await getActivityLearners({ component: String(componentId) });
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
      timestamp_display: row.time_from_to ?? "",
      item_title: null,
    }));
    const first = learners.items[0];
    return {
      component_id: componentId,
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
  const response = await fetch(`${BASE}/edit/`, {
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

// After an edit, reset the module-level read caches so react-query refetches
// pull fresh data (the server busts its own cache too).
export function invalidateOtjhCaches() {
  cohortPromise = null;
  activityCache.clear();
}
