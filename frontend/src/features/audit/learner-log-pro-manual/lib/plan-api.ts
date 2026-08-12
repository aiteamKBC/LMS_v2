// Client for the manual plan-builder endpoints (/manual_audit_api/plan/*).
// The builder authors group plans; the Learner Journal / Activity Log render
// the result through the existing ledger feed (see lib/api.ts) — this module
// never touches those read paths beyond invalidating their caches after writes.
import { invalidateOtjhCaches } from "@/features/audit/learner-log-pro-manual/lib/api";

const PLAN_BASE = "/manual_audit_api/plan";

export type PlanKsbs = {
  K: Array<{ code: string; description?: string | null }>;
  S: Array<{ code: string; description?: string | null }>;
  B: Array<{ code: string; description?: string | null }>;
};

export type PlanGroup = {
  id: number;
  name: string;
  kind: "cohort" | "individual";
  programme_id: number | null;
  programme_name: string | null;
  aptem_group?: string | null;
  status: "draft" | "active" | "archived";
  start_month: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  member_count?: number;
  activity_count?: number;
};

export type PlanMonth = {
  month_index: number;
  calendar_month: string;
  label: string;
  anchor_date: string | null;
};

export type PlanMember = {
  aptem_id: number;
  name: string | null;
  email: string | null;
  joined_at: string | null;
};

export type PlanActivity = {
  activity_key: string;
  month_index: number;
  week_slot: number;
  position: number;
  category: "attendance" | "assignment" | "video" | "audio" | "reading+quiz";
  title: string;
  subtitle: string | null;
  material_ref: string | null;
  planned_hours: number;
  planned_date: string | null;
  included: boolean;
  ksbs: PlanKsbs | null;
  updated_by: string | null;
  updated_at: string | null;
  exempted: number[];
};

export type PlanGroupDetail = PlanGroup & {
  months: PlanMonth[];
  members: PlanMember[];
  activities: PlanActivity[];
};

export type SignedWarning = { aptem_id: string; month: string };

export type SuggestedMember = {
  aptem_id: number;
  name: string | null;
  email: string | null;
  programme: string | null;
  status: string;
  lms_linked: boolean;
  in_this_group: boolean;
  in_other_group: boolean;
};

export type AttendanceSessionOption = {
  session_ref: string;
  date: string;
  module: string;
  total_learners: number;
  member_learners: number;
  members_attended: number;
  default_hours: number;
};

export type MaterialOption = {
  material_ref: string;
  activity_id: number;
  type: string;
  title: string;
  activity_date: string | null;
  suggested_hours: number | null;
  has_iframe: boolean;
  has_text: boolean;
  has_quiz: boolean;
  engaged_members: number;
};

export type AssignmentOption = {
  material_ref: string;
  name_key: string;
  name: string;
  learner_count: number;
  learners: Array<{
    aptem_id: number;
    component_id: number;
    component_name: string;
    assignment_month: string | null;
    status: string | null;
  }>;
  status_counts: Record<string, number>;
  month_counts: Record<string, number>;
  suggested_hours: number | null;
};

export type LmsGroupOption = { group_id: number; name: string; learner_count: number };

export type ProgressPatch = Partial<{
  status: "not_started" | "in_progress" | "completed" | "not_accepted";
  completion_date: string | null;
  actual_hours: number | null;
  attendance_status: "attended" | "absent" | "makeup" | null;
  quiz_attempted: boolean | null;
  quiz_passed: boolean | null;
  reading_viewed: boolean | null;
  note: string | null;
  suggestion_accepted: boolean;
  rejected: boolean;
  timestamp_from: string | null;
  timestamp_to: string | null;
}>;

export type NewPlanActivity = {
  category: PlanActivity["category"];
  title: string;
  subtitle?: string | null;
  month_index: number;
  week_slot?: number;
  material_ref?: string | null;
  planned_hours?: number | null;
  planned_date?: string | null;
  ksbs?: PlanKsbs | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PLAN_BASE}${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Plan request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

// Any plan write can change what the journal / activity log / search table
// show, so every mutation busts the ledger read caches.
async function mutate<T>(path: string, init: RequestInit): Promise<T> {
  const result = await request<T>(path, init);
  invalidateOtjhCaches();
  return result;
}

export function listPlanGroups() {
  return request<{ items: PlanGroup[] }>("/groups");
}

// --- learner-first plans ------------------------------------------------------
// One plan per learner (an 'individual' plan_groups row under the hood): the
// months are the learner's own Aptem training plan, labels untouched.

export type LearnerPlan = {
  id: number;
  name: string;
  aptem_id: number;
  learner_name: string | null;
  learner_email: string | null;
  programme_name: string | null;
  aptem_group: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  month_count: number;
  activity_count: number;
};

export type AptemLearnerHit = {
  aptem_id: number;
  name: string | null;
  email: string | null;
  programme_name: string | null;
  aptem_group: string | null;
  plan_id: number | null;
  has_training_plan: boolean;
};

export function listLearnerPlans() {
  return request<{ items: LearnerPlan[] }>("/learners");
}

export function addLearnerPlan(aptemId: number, createdBy?: string) {
  return mutate<LearnerPlan>("/learners", {
    method: "POST",
    body: JSON.stringify({ aptem_id: aptemId, created_by: createdBy }),
  });
}

export function searchAptemLearners(query: string) {
  return request<{ items: AptemLearnerHit[] }>(`/pickers/aptem-learners?q=${encodeURIComponent(query)}`);
}

export function getPlanGroup(groupId: number) {
  return request<PlanGroupDetail>(`/groups/${groupId}`);
}

export function createPlanGroup(payload: {
  name: string;
  kind?: "cohort" | "individual";
  programme_name?: string | null;
  start_month?: string | null;
  months_count?: number;
  members?: number[];
  // Aptem-group driven creation (the source of truth): the (programme, group)
  // pair's Aptem learners are assigned automatically and the months come from
  // their Aptem training plans (each learner keeping their OWN dates).
  aptem_group?: string | null;
  lms_group_id?: number | null;
  months_from_training_plan?: boolean;
  created_by?: string;
}) {
  return mutate<PlanGroupDetail>("/groups", { method: "POST", body: JSON.stringify(payload) });
}

export function updatePlanGroup(groupId: number, payload: {
  name?: string;
  status?: PlanGroup["status"];
  programme_name?: string | null;
  updated_by?: string;
}) {
  return mutate<PlanGroup>(`/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function archivePlanGroup(groupId: number, updatedBy?: string) {
  return mutate<{ ok: boolean }>(`/groups/${groupId}`, {
    method: "DELETE",
    body: JSON.stringify({ updated_by: updatedBy }),
  });
}

export function updatePlanMembers(groupId: number, payload: {
  add?: number[];
  remove?: number[];
  updated_by?: string;
}) {
  return mutate<{ ok: boolean; added: number[]; removed: number[]; members: PlanMember[] }>(
    `/groups/${groupId}/members`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function updatePlanMonths(groupId: number, months: Array<Partial<PlanMonth>>, updatedBy?: string) {
  return mutate<{ ok: boolean; months: PlanMonth[] }>(`/groups/${groupId}/months`, {
    method: "PUT",
    body: JSON.stringify({ months, updated_by: updatedBy }),
  });
}

export function suggestPlanMembers(groupId: number) {
  return request<{ items: SuggestedMember[] }>(`/groups/${groupId}/suggest-members`);
}

export type MatrixCell = {
  progress?: {
    status: string;
    completion_date: string | null;
    actual_hours: number | null;
    attendance_status: string | null;
    quiz_attempted: boolean | null;
    quiz_passed: boolean | null;
    reading_viewed: boolean | null;
    note: string | null;
    rejected: boolean;
    suggestion_accepted: boolean;
  };
  suggestion?: {
    kind: "lms" | "attendance" | "assignment";
    completed?: boolean;
    attended?: boolean;
    reading_viewed?: boolean | null;
    quiz_attempted?: boolean | null;
    quiz_passed?: boolean | null;
    actual_hours?: number | null;
    date?: string | null;
    status?: string | null;
    assignment_month?: string | null;
  };
};

export type PlanMatrix = {
  group_id: number;
  month_index: number;
  activities: Array<{
    activity_key: string;
    week_slot: number;
    position: number;
    category: PlanActivity["category"];
    title: string;
    material_ref: string | null;
    planned_hours: number;
    planned_date: string | null;
    exempted: number[];
  }>;
  members: Array<{ aptem_id: number; name: string | null; lms_linked: boolean }>;
  cells: Record<string, MatrixCell>;
};

export function getPlanMatrix(groupId: number, monthIndex: number) {
  return request<PlanMatrix>(`/groups/${groupId}/matrix?month_index=${monthIndex}`);
}

// The group's Aptem training plan: the general (majority) backbone with each
// member's own status/date per module. month_index lines up with plan months.
export type GroupTrainingPlanLearner = {
  aptem_id: number;
  name: string | null;
  status: string;
  bucket: "completed" | "in_progress" | "not_started" | "other" | "missing";
  date: string | null;
};

export type GroupTrainingPlanModule = {
  name: string;
  type: string;
  counts: { completed: number; in_progress: number; not_started: number; other: number; missing: number };
  learners: GroupTrainingPlanLearner[];
};

export type GroupTrainingPlan = {
  group_id: number;
  members_total: number;
  members_with_plan: number;
  majority_count: number;
  members_without_plan: Array<{ aptem_id: number; name: string | null }>;
  months: Array<{
    month_index: number;
    label: string | null;
    date: string | null;
    modules: GroupTrainingPlanModule[];
  }>;
};

export function getGroupTrainingPlan(groupId: number) {
  return request<GroupTrainingPlan>(`/groups/${groupId}/training-plan`);
}

export function addPlanActivities(payload: {
  group_id: number;
  activities: NewPlanActivity[];
  assignment_refs?: Array<{
    aptem_id: number;
    component_id: number;
    component_name?: string;
    assignment_month?: string | null;
  }>;
  created_by?: string;
}) {
  return mutate<{ ok: boolean; activity_keys: string[]; duplicate_refs: string[]; signed_warnings: SignedWarning[] }>(
    "/activities",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function patchPlanActivity(activityKey: string, patch: Record<string, unknown>, updatedBy?: string) {
  return mutate<{ ok: boolean; signed_warnings: SignedWarning[] }>("/activities", {
    method: "PATCH",
    body: JSON.stringify({ activity_key: activityKey, patch, updated_by: updatedBy }),
  });
}

export function excludePlanActivity(activityKey: string, updatedBy?: string) {
  return mutate<{ ok: boolean; progress_rows_kept: number; signed_warnings: SignedWarning[] }>("/activities", {
    method: "DELETE",
    body: JSON.stringify({ activity_key: activityKey, updated_by: updatedBy }),
  });
}

export function savePlanProgress(payload: {
  aptem_id: number;
  activity_key: string;
  patch: ProgressPatch;
  updated_by?: string;
}) {
  return mutate<{ ok: boolean; signed_warnings: SignedWarning[] }>("/progress", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function clearPlanProgress(aptemId: number, activityKey: string) {
  return mutate<{ ok: boolean }>("/progress", {
    method: "DELETE",
    body: JSON.stringify({ aptem_id: aptemId, activity_key: activityKey }),
  });
}

export function savePlanProgressBulk(payload: {
  activity_key: string;
  aptem_ids: number[];
  patch: ProgressPatch;
  updated_by?: string;
}) {
  return mutate<{ ok: boolean; updated: number; signed_warnings: SignedWarning[] }>("/progress/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function pickAttendanceSessions(groupId: number, month: string, all = false) {
  const query = new URLSearchParams({ group_id: String(groupId), month });
  if (all) query.set("all", "1");
  return request<{ items: AttendanceSessionOption[]; member_count: number }>(
    `/pickers/attendance-sessions?${query}`,
  );
}

// The bulk-attendance sheet: learners x session days for one month, matching
// the student portal's /bulk layout.
export type AttendanceGrid = {
  month: string;
  days: Array<{
    session_ref: string;
    date: string;
    module: string;
    default_hours: number;
    member_attended: number;
    member_rows: number;
    total_learners: number;
  }>;
  learners: Array<{ aptem_id: number; name: string | null; is_member: boolean }>;
  cells: Record<string, { attended: boolean; hours: number | null; status: string | null }>;
};

export function pickAttendanceGrid(groupId: number, month: string, all = false) {
  const query = new URLSearchParams({ group_id: String(groupId), month });
  if (all) query.set("all", "1");
  return request<AttendanceGrid>(`/pickers/attendance-grid?${query}`);
}

export function pickMaterials(params: {
  groupId: number;
  type?: "video" | "reading+quiz" | "audio";
  search?: string;
  scope?: "group" | "all";
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams({ group_id: String(params.groupId) });
  if (params.type) query.set("type", params.type);
  if (params.search) query.set("search", params.search);
  if (params.scope) query.set("scope", params.scope);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return request<{ items: MaterialOption[]; scope: string }>(`/pickers/materials?${query}`);
}

export function pickAssignments(groupId: number) {
  return request<{ items: AssignmentOption[]; member_count: number }>(
    `/pickers/assignments?group_id=${groupId}`,
  );
}

export function pickKsbs(standard?: string, search?: string) {
  const query = new URLSearchParams();
  if (standard) query.set("standard", standard);
  if (search) query.set("search", search);
  return request<{ standards: string[]; ksbs: PlanKsbs }>(`/pickers/ksbs?${query}`);
}

export type AssignmentEvidence = {
  aptem_id: number;
  name: string | null;
  documents: Array<{
    evidence_id: number;
    name: string | null;
    kind: string | null;
    status: string | null;
    submission_date: string | null;
    open_url: string | null;
    aptem_url: string | null;
  }>;
};

export function pickAssignmentEvidence(groupId: number, nameKey: string) {
  const query = new URLSearchParams({ group_id: String(groupId), name_key: nameKey });
  return request<{ items: AssignmentEvidence[] }>(`/pickers/assignment-evidence?${query}`);
}

export function pickLmsGroups(programme?: string) {
  const query = programme ? `?programme=${encodeURIComponent(programme)}` : "";
  return request<{ items: LmsGroupOption[] }>(`/pickers/lms-groups${query}`);
}

// Aptem is the source of truth: programmes exactly as named (cohort included),
// and each programme's groups from Aptem's own Group field.
export function pickAptemProgrammes() {
  return request<{ items: Array<{ programme: string; aptem_learners: number; in_cohort: number }> }>(
    "/pickers/aptem-programmes",
  );
}

export function pickAptemGroups(programme: string) {
  return request<{ items: Array<{ group: string; aptem_learners: number; in_cohort: number }> }>(
    `/pickers/aptem-groups?programme=${encodeURIComponent(programme)}`,
  );
}

// The programme's GENERAL training plan (the majority plan among its
// learners): months with their modules, straight from Aptem.
export type GeneralTrainingPlan = {
  programme: string;
  learners_with_plan: number;
  majority_count?: number;
  total_modules?: number;
  months?: Array<{
    month: string | null;
    date: string | null;
    modules: Array<{ name: string | null; type: string | null; status: string | null }>;
  }> | null;
};

export function pickTrainingPlan(programme: string) {
  return request<GeneralTrainingPlan>(
    `/pickers/training-plan?programme=${encodeURIComponent(programme)}`,
  );
}

export function pickLmsGroupMembers(lmsGroupId: number) {
  return request<{ items: Array<{ aptem_id: number; name: string; email: string | null; status: string }> }>(
    `/pickers/lms-groups?group_id=${lmsGroupId}`,
  );
}
