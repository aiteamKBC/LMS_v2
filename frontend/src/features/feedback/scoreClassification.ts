import type { FeedbackScoreClass } from '@/api/feedback';

export const POSITIVE_SCORE_MIN = 75;
export const NEUTRAL_SCORE_MIN = 50;
export const SCORE_CLASSIFICATION_TEXT = `Positive ≥${POSITIVE_SCORE_MIN}%, Neutral ≥${NEUTRAL_SCORE_MIN}% and <${POSITIVE_SCORE_MIN}%, Negative <${NEUTRAL_SCORE_MIN}%.`;

export function classifyScore(score: number | null): FeedbackScoreClass {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return 'unscored';
  return score >= POSITIVE_SCORE_MIN ? 'positive' : score >= NEUTRAL_SCORE_MIN ? 'neutral' : 'negative';
}
