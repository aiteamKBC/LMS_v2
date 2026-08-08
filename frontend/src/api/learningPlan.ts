// ============================================================================
// Learning plan API client
// The modules a learner will actually be taught. Seeded from their group's
// preset (curriculum.groups.module_ids) and editable within the same programme.
// Persisted on enrolment."Created_users"."Learning_plan" (jsonb).
// ============================================================================
const BASE = '/learner_api/learning-plan';

export interface LearningPlanModule {
  moduleId: string;
  moduleTitle: string;
  groupName: string;
  programmeName: string;
  /** Off-the-job hours for this module (curriculum.modules.total_otjh). */
  hours: number;
  /**
   * Saved on the plan but no longer in the programme's catalogue — either the
   * module was retired, or the row predates this shape. Kept rather than
   * silently dropped, since the plan is a record of what was agreed.
   */
  orphaned?: boolean;
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
    cohort: string;
    group: string;
    programmeStatus: string;
  };
  /** The current plan — the saved one, or the group preset if never saved. */
  plan: LearningPlanModule[];
  /** The learner's group's modules, for "reset to group default". */
  preset: LearningPlanModule[];
  /** Same-programme modules not already on the plan, for the add picker. */
  available: LearningPlanModule[];
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

/** Save the plan. Order is preserved; hours/titles are re-derived server-side. */
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

export function formatHours(hours: number): string {
  return `${Number(hours || 0).toFixed(2).replace(/\.00$/, '')} h`;
}
