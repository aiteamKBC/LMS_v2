import type { FeedbackQuestion, FeedbackQuestionAnalyticsSettings } from '@/api/feedback';

export const IMPORTANCE_OPTIONS = [
  { value: 'critical', label: 'Critical', weight: 4 },
  { value: 'high', label: 'High', weight: 3 },
  { value: 'medium', label: 'Medium', weight: 2 },
  { value: 'low', label: 'Low', weight: 1 },
] as const;

export function questionAnalyticsSettings(question: FeedbackQuestion): Required<Omit<FeedbackQuestionAnalyticsSettings, 'scoreMin' | 'scoreMax'>> & Pick<FeedbackQuestionAnalyticsSettings, 'scoreMin' | 'scoreMax'> {
  const raw = question.config.analytics;
  return {
    importance: raw?.importance ?? 'medium', scoring: raw?.scoring ?? (question.type === 'rating' ? 'higher' : 'none'),
    includeInOverall: raw?.includeInOverall ?? true, optionScores: raw?.optionScores ?? {},
    ...(question.type === 'number' ? { scoreMin: raw?.scoreMin, scoreMax: raw?.scoreMax } : {}),
  };
}

export function analyticsForNewType(question: FeedbackQuestion, type: FeedbackQuestion['type']): Pick<FeedbackQuestion['config'], 'analytics'> {
  if (!question.config.analytics) return {};
  const settings = questionAnalyticsSettings(question);
  return { analytics: {
    importance: settings.importance,
    includeInOverall: settings.includeInOverall,
    scoring: type === 'rating' ? 'higher' : 'none',
  } };
}

// Answer labels own their scores. Reordering keeps scores attached to the
// answer; a renamed answer retains its score, while a new answer starts blank.
export function withAnswerOptions(question: FeedbackQuestion, options: string[]): FeedbackQuestion['config'] {
  const config = { ...question.config, options };
  const oldScores = question.config.analytics?.optionScores;
  if (!oldScores) return config;
  const oldOptions = question.config.options || [];
  const optionScores: Record<string, number> = {};
  for (const [index, option] of options.entries()) {
    const oldLabel = oldOptions[index];
    const score = oldScores[option] ?? (oldLabel && !options.includes(oldLabel) ? oldScores[oldLabel] : undefined);
    if (score !== undefined) optionScores[option] = score;
  }
  return { ...config, analytics: { ...config.analytics, optionScores } };
}
