// Employee-arranged monthly ledger — the journal's data source.
//
// The journal no longer auto-arranges hours from Last_audit. Employees build
// each learner's monthly report by hand: original planned hours come from
// Last_audit.learners.planned_hours_monthly, everything else (activity rows,
// planned/actual hours, assignment evidence uploads) is what they enter here.
// All of it is stored in the structured_manual_activities schema behind the
// /audit_api/last-audit/manual/* Django endpoints.

const MANUAL_BASE = "/audit_api/last-audit/manual";

export const MANUAL_CATEGORIES = [
  "attendance",
  "video",
  "audio",
  "reading+quiz",
  "assignment",
] as const;

export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

export type ManualDocument = {
  id: number;
  manual_activity_id: number;
  display_name: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  download_url: string | null;
};

export type ManualRow = {
  id: number;
  aptem_id: number;
  learner_id: number | null;
  month: string;
  month_label: string;
  category: ManualCategory;
  source_ref: string | null;
  group_id: number | null;
  activity_id: number | null;
  title: string;
  activity_date: string | null;
  planned_hours: number;
  actual_hours: number;
  timestamp_label: string;
  completion_note: string | null;
  accepted: boolean;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
  documents: ManualDocument[];
};

export type ManualMonth = {
  month: string;
  label: string;
  original_planned: number | null;
  arranged_planned: number;
  arranged_actual: number; // accepted rows only ("claimed")
  arranged_not_accepted: number;
  row_count: number;
};

export type ManualSummary = {
  aptem_id: number;
  learner_id: number | null;
  learner_name: string | null;
  learner_email: string | null;
  programme_name: string | null;
  programme_status: string | null;
  coach_name: string | null;
  coach_email: string | null;
  planned_hours_total: number | null;
  months: ManualMonth[];
  arranged_planned_total: number;
  arranged_actual_total: number;
};

export type ManualGroup = {
  group_id: number;
  group_name: string;
  counts: Record<string, number>;
};

export type CompletionState = "completed" | "not_completed" | "no_record";

export type GroupActivityOption = {
  activity_id: number;
  source_ref: string;
  title: string;
  activity_date: string | null;
  duration_minutes: number | null; // configured media length (videos mostly)
  completion: { state: CompletionState };
};

/** "29 min" / "1 h 05 min" — the employee's anchor for deciding actual hours. */
export function formatDurationMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")} min` : `${hours} h`;
}

/** The same duration expressed in decimal hours (2 dp) for the Actual field. */
export function durationAsHours(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round((minutes / 60) * 100) / 100;
}

export type AttendanceOption = {
  source_key: string;
  source_ref: string;
  attendance_date: string | null;
  lecture_name: string | null;
  module: string | null;
  attended: boolean;
  attendance_status: string;
  activity_hours: number | null;
};

export type ManualRowsResponse = {
  aptem_id: number;
  month: string | null;
  count: number;
  planned_sum: number;
  actual_sum: number; // accepted rows only ("claimed")
  not_accepted_sum: number;
  rows: ManualRow[];
};

export type LedgerActivity = {
  activity_id?: number;
  title: string;
  activity_date: string | null;
  activity_type: string | null;
  module?: string | null;
  content_url: string | null;
  reading_text_body: string | null;
  configured_duration_minutes?: number | null;
  quiz: {
    description: string | null;
    questions: unknown[];
    maximum_score: number | null;
    passing_score: number | null;
  } | null;
};

export type LedgerParticipant = ManualRow & { learner_name: string };

// Everyone who actually did the activity at the source (whole register
// session / every enrolled learner's LMS result), independent of the report.
export type LedgerSourceParticipant = {
  aptem_id: number | null;
  learner_name: string;
  status: "attended" | "absent" | "completed" | "not_completed" | "no_record";
  on_report: boolean;
  report_months: string[];
};

export type ActivityLedger = {
  ref: string;
  category: string;
  activity: LedgerActivity;
  participants: LedgerParticipant[];
  source_participants: LedgerSourceParticipant[];
};

export class ManualApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MANUAL_BASE}${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ManualApiError(
      payload?.error ?? `Manual ledger request failed (${response.status})`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

function jsonInit(method: string, body: Record<string, unknown>): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function getManualSummary(aptemId: number | string): Promise<ManualSummary> {
  return request(`/summary?aptem_id=${encodeURIComponent(String(aptemId))}`);
}

export function getManualGroups(aptemId: number | string): Promise<{
  aptem_id: number;
  lms_matched: boolean;
  groups: ManualGroup[];
}> {
  return request(`/groups?aptem_id=${encodeURIComponent(String(aptemId))}`);
}

export function getGroupActivityOptions(params: {
  aptemId: number | string;
  groupId: number;
  category: Exclude<ManualCategory, "attendance" | "assignment">;
}): Promise<{ count: number; activities: GroupActivityOption[] }> {
  const query = new URLSearchParams({
    aptem_id: String(params.aptemId),
    group_id: String(params.groupId),
    category: params.category,
  });
  return request(`/group-activities?${query}`);
}

export function getAttendanceOptions(aptemId: number | string): Promise<{
  count: number;
  options: AttendanceOption[];
}> {
  return request(`/attendance-options?aptem_id=${encodeURIComponent(String(aptemId))}`);
}

export function getManualRows(aptemId: number | string, month?: string): Promise<ManualRowsResponse> {
  const query = new URLSearchParams({ aptem_id: String(aptemId) });
  if (month) query.set("month", month);
  return request(`/rows?${query}`);
}

export type CreateManualRowInput = {
  aptem_id: number;
  month: string;
  category: ManualCategory;
  source_ref?: string | null;
  title: string;
  activity_date?: string | null;
  planned_hours: number;
  actual_hours: number;
  timestamp_label?: string;
  completion_note?: string | null;
  accepted?: boolean;
  created_by?: string | null;
};

export function createManualRow(input: CreateManualRowInput): Promise<ManualRow> {
  return request("/rows", jsonInit("POST", input));
}

export type ManualRowPatch = Partial<{
  title: string;
  activity_date: string | null;
  month: string;
  planned_hours: number;
  actual_hours: number;
  timestamp_label: string;
  accepted: boolean;
}>;

export function patchManualRow(id: number, patch: ManualRowPatch, updatedBy?: string): Promise<ManualRow> {
  return request("/rows", jsonInit("PATCH", { id, patch, updated_by: updatedBy ?? null }));
}

export function deleteManualRow(id: number, updatedBy?: string): Promise<{ ok: boolean; id: number }> {
  return request("/rows", jsonInit("DELETE", { id, updated_by: updatedBy ?? null }));
}

export function uploadAssignmentDocument(
  manualActivityId: number,
  file: File,
  uploadedBy?: string,
): Promise<ManualDocument> {
  const form = new FormData();
  form.append("manual_activity_id", String(manualActivityId));
  form.append("file", file);
  if (uploadedBy) form.append("uploaded_by", uploadedBy);
  return request("/documents", { method: "POST", body: form });
}

export function getAssignmentDocuments(manualActivityId: number): Promise<{
  manual_activity_id: number;
  documents: ManualDocument[];
}> {
  return request(`/documents?manual_activity_id=${manualActivityId}`);
}

export function deleteAssignmentDocument(id: number): Promise<{ ok: boolean; id: number }> {
  return request("/documents", jsonInit("DELETE", { id }));
}

export function getActivityLedger(ref: string): Promise<ActivityLedger> {
  return request(`/activity-ledger?ref=${encodeURIComponent(ref)}`);
}

// --- retrieve + bulk save (the journal's draft workflow) --------------------

export type ImportAttendanceCandidate = {
  source_ref: string;
  category: "attendance";
  title: string;
  group_name: string;
  activity_date: string;
  attended: boolean;
  timestamp_label: string;
};

export type ImportActivityCandidate = {
  source_ref: string;
  category: string;
  title: string;
  group_name: string;
  activity_date: string | null;
  duration_minutes: number | null;
  completion: { state: CompletionState };
  group_id: number;
  activity_id: number;
  pair?: {
    anchor_activity_id: number;
    activity_ids: number[];
    titles: string[];
  };
};

export type ImportCandidatesResponse = {
  aptem_id: number;
  month: string;
  attendance_source: string;
  attendance: ImportAttendanceCandidate[];
  activities: ImportActivityCandidate[];
  already_added: string[];
};

export function getImportCandidates(aptemId: number | string, month: string): Promise<ImportCandidatesResponse> {
  const query = new URLSearchParams({ aptem_id: String(aptemId), month });
  return request(`/import-candidates?${query}`);
}

export type AutoImportResponse = {
  ok: boolean;
  aptem_id: number;
  month: string;
  attendance_source: string;
  created: number;
  skipped_existing: number;
  locked: boolean;
};

// Fills the month with everything the LMS holds for this learner (attendance
// sessions, completed activities and approved assignments) directly on the
// server. Idempotent: refs ever filed for the month — even later deleted —
// are never re-inserted, so employee deletions stay respected.
export function autoImportManualRows(input: {
  aptem_id: number;
  month: string;
  created_by?: string | null;
}): Promise<AutoImportResponse> {
  return request("/rows/auto-import", jsonInit("POST", input));
}

export function createReadingQuizPair(input: {
  group_id: number;
  activity_ids: number[];
}): Promise<{ ok: boolean; created: number }> {
  return request("/reading-quiz-pairs", jsonInit("POST", input));
}

export function deleteReadingQuizPair(input: {
  group_id: number;
  activity_ids: number[];
}): Promise<{ ok: boolean; deleted: number }> {
  return request("/reading-quiz-pairs", jsonInit("DELETE", input));
}

export type BulkCreateInput = Omit<CreateManualRowInput, "aptem_id" | "created_by"> & { key: string };

export type BulkSaveResponse = {
  ok: boolean;
  created: Array<{ key: string; row: ManualRow }>;
  skipped: Array<{ key: string; source_ref: string | null }>;
  updated: number;
  deleted: number;
  missing: number[];
};

export function bulkSaveManualRows(input: {
  aptem_id: number;
  updated_by?: string | null;
  creates: BulkCreateInput[];
  updates: Array<{ id: number; patch: ManualRowPatch }>;
  deletes: number[];
}): Promise<BulkSaveResponse> {
  return request("/rows/bulk", jsonInit("POST", input));
}

// The PDF export and legacy table cells consume the journal's LearnerActivity
// shape; give a manual row the same silhouette instead of changing shared types.
export function manualRowToJournalActivity(row: ManualRow) {
  return {
    id: `manual:${row.id}`,
    mre_id: String(row.id),
    plan_id: row.source_ref ?? `manual:${row.id}`,
    learner: "",
    month_unit: row.month_label,
    source_course: null,
    activity_unit: row.title,
    section_title: null,
    activity_description: null,
    learner_activity_date: row.activity_date,
    activity_date: row.activity_date,
    activity_period: row.month,
    delivery_method: row.category,
    activity_category: row.category,
    time_from_to: row.timestamp_label || null,
    time_from: null,
    time_to: null,
    actual_lms_hours: row.actual_hours,
    planned_hours: row.planned_hours,
    not_accepted: !row.accepted,
  };
}
