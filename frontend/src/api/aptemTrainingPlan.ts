import type { LearnerKind } from './learnerDetail';

// Mirrors GET /learner_api/training-plan/{kind}/{id}/ — the learner's Aptem
// training plan (Audit.learner_match.aptem_training_plan), resolved server-side
// by aptem_id (email-confirmed). Shape: months → modules → components{type,status}.
// Named "aptem…" to avoid colliding with the curriculum TrainingPlan in ./trainingPlan.
export interface AptemPlanComponent {
  type: string | null;
  status: string | null;
}
export interface AptemPlanModule {
  module: string | null;
  components: AptemPlanComponent | null;
}
export interface AptemPlanMonth {
  month: string | null;
  date: string | null;
  modules: AptemPlanModule[];
}
export interface AptemTrainingPlanResponse {
  source: string;
  aptem_id: number;
  learner_name: string | null;
  programme_name: string | null;
  months: AptemPlanMonth[];
}

export async function fetchAptemTrainingPlan(
  kind: LearnerKind,
  learnerId: string,
  signal?: AbortSignal,
): Promise<AptemTrainingPlanResponse> {
  let response: Response;
  try {
    response = await fetch(`/learner_api/training-plan/${kind}/${learnerId}/`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    throw new Error('Could not reach the server.');
  }

  const payload = (await response.json().catch(() => null)) as (AptemTrainingPlanResponse & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  if (!payload || !Array.isArray(payload.months)) throw new Error('Received an invalid training plan response.');
  return payload;
}
