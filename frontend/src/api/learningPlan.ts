// ============================================================================
// Learning plan API client
// The modules a learner will actually be taught. Seeded from their group's
// preset (curriculum.groups.module_ids), then editable from the whole module
// catalogue — the picker offers every programme, not only the learner's own, so
// each module carries the programme it came from.
// Persisted on enrolment."Created_users"."Learning_plan" (jsonb).
// ============================================================================
import { formatHoursMinutes } from '@/lib/format';
const BASE = '/learner_api/learning-plan';
const MODULE_BASE = '/learner_api/module-learners';

export interface LearningPlanModule {
  moduleId: string;
  moduleTitle: string;
  groupName: string;
  /** The programme this module belongs to — not necessarily the learner's. */
  programmeId: string;
  programmeName: string;
  /** Off-the-job hours for this module (curriculum.modules.total_otjh). */
  hours: number;
  /**
   * The module's delivery window (curriculum.modules start_date/end_date), as
   * YYYY-MM-DD — '' when the module has not been scheduled. Read-only: it is
   * set where the module is scheduled, not on the plan.
   */
  startDate?: string;
  endDate?: string;
  /**
   * Saved on the plan but no longer in the catalogue — either the module was
   * retired, or the row predates this shape. Kept rather than silently
   * dropped, since the plan is a record of what was agreed.
   */
  orphaned?: boolean;
}

/** A programme the picker can switch to, with how many modules it offers. */
export interface LearningPlanProgramme {
  programmeId: string;
  programmeName: string;
  moduleCount: number;
}

export interface LearningPlanTotals {
  moduleCount: number;
  totalHours: number;
}

export interface LearningPlanResponse {
  learner: {
    id: string;
    name: string;
    programme: string;
    /** The learner's own programme, which the picker opens on. */
    programmeId: string;
    cohort: string;
    group: string;
    programmeStatus: string;
  };
  /** The current plan — the saved one, or the group preset if never saved. */
  plan: LearningPlanModule[];
  /** The learner's group's modules, for "reset to group default". */
  preset: LearningPlanModule[];
  /** Every catalogue module not already on the plan, for the add picker. */
  available: LearningPlanModule[];
  /** The programmes to choose between in the picker. */
  programmes: LearningPlanProgramme[];
  /** False when the plan shown is still just the group preset. */
  saved: boolean;
  totals: LearningPlanTotals;
}

async function parse(res: Response) {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body (proxy/HTML error page) — keep the status message.
    }
    throw new Error(message);
  }
  return res.json();
}

export async function fetchLearningPlan(learnerId: string | number): Promise<LearningPlanResponse> {
  return parse(await fetch(`${BASE}/${learnerId}/`));
}

/** Save the plan. Order is preserved; hours/titles/dates are re-derived server-side. */
export async function saveLearningPlan(
  learnerId: string | number,
  moduleIds: string[],
): Promise<LearningPlanResponse> {
  return parse(
    await fetch(`${BASE}/${learnerId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: moduleIds.map((moduleId) => ({ moduleId })) }),
    }),
  );
}

/** A module's window date for reading. '' stays an em dash, not "Invalid Date". */
export function formatPlanDate(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatHours(hours: number): string {
  return formatHoursMinutes(Number(hours || 0));
}

// ---------------------------------------------------------------------------
// The same assignment from the module's side
// ---------------------------------------------------------------------------
// The Module builder's "Assign learners" picker: one module, every learner in
// enrolment."Created_users", ticked on or off. A tick is a plan save — it
// appends this module to that learner's plan and an untick removes it — so
// there is no second roster to disagree with the plans above.
// ---------------------------------------------------------------------------

/** One learner in the picker, with whether this module is already theirs. */
export interface ModuleLearnerRow {
  id: string;
  name: string;
  email: string;
  /** 'apprenticeship' | 'commercial'. */
  learnerType: string;
  programme: string;
  cohort: string;
  group: string;
  programmeStatus: string;
  assigned: boolean;
  /**
   * Assigned because their group teaches this module, not because anyone
   * agreed their plan. Saving the picker unchanged leaves it that way.
   */
  fromPreset: boolean;
  /** How many modules their plan holds in total, this one included. */
  moduleCount: number;
}

export interface ModuleLearnersResponse {
  module: {
    moduleId: string;
    moduleTitle: string;
    programmeId: string;
    programmeName: string;
    groupName: string;
    hours: number;
    startDate: string;
    endDate: string;
  };
  learners: ModuleLearnerRow[];
  totals: { learnerCount: number; assignedCount: number };
  /** Only on a save: how many learners' plans actually changed. */
  changedCount?: number;
}

export async function fetchModuleLearners(moduleId: string): Promise<ModuleLearnersResponse> {
  return parse(await fetch(`${MODULE_BASE}/${encodeURIComponent(moduleId)}/`));
}

/**
 * Set who is assigned to this module. The list is the whole assignment, not a
 * delta: a learner left out of it has the module removed from their plan.
 *
 */
export async function saveModuleLearners(
  moduleId: string,
  learnerIds: Array<string | number>,
): Promise<ModuleLearnersResponse> {
  return parse(
    await fetch(`${MODULE_BASE}/${encodeURIComponent(moduleId)}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learnerIds: learnerIds.map(String) }),
    }),
  );
}
