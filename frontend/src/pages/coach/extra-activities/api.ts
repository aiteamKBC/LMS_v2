import { coachFetch } from '@/lib/coachFetch';
import type { LearnerKind } from '@/api/learnerDetail';

export interface ExtraLearner { id: number; kind: LearnerKind; name: string; programme: string }
export interface CoachExtraActivity {
  id: string; learnerId: string; learnerKind: LearnerKind; learner: string; title: string;
  status: string; hours: string; month: string; addedBy: string | null; reviewedBy: string | null; submittedAt: string;
}
export async function readExtraActivities(query: URLSearchParams, signal?: AbortSignal) {
  const response = await coachFetch(`/coach_api/coach/extra-activities?${query}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'Could not load extra activities.');
  return data as { items: CoachExtraActivity[]; total: number; hasNext: boolean };
}
export async function readExtraLearners(signal?: AbortSignal): Promise<ExtraLearner[]> {
  const response = await coachFetch('/coach_api/coach/extra-activities/learners', { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'Could not load your learners.');
  return data.learners;
}
