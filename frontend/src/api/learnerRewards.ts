import type { LearnerKind } from './learnerDetail';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

export type LearnerRewardsSummary = {
  points: { learnerId: string; earned: number; committed: number; balance: number };
  rewards: { id: string; name: string; description: string; points: number; category: string; remaining: number }[];
};
const url = (kind: LearnerKind, id: string) => `/learner_api/rewards-summary/${kind}/${encodeURIComponent(id)}/`;
const valid = (data: LearnerRewardsSummary | undefined, id: string) => data?.points?.learnerId === id
  && ['earned', 'committed', 'balance'].every(key => Number.isFinite(data.points[key as keyof typeof data.points]))
  && Array.isArray(data.rewards);
export function peekLearnerRewards(kind: LearnerKind, id: string) {
  const data = peekLearnerJson<LearnerRewardsSummary>(url(kind, id));
  return valid(data, id) ? data : undefined;
}
export async function fetchLearnerRewards(kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) {
  const data = await readLearnerJson<LearnerRewardsSummary>(url(kind, id), { signal, ttlMs: 30_000, revalidate: fresh });
  if (!valid(data, id)) throw new Error('Could not load your rewards and points. Please try again.');
  return data;
}
