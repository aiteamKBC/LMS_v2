import type { FeedbackAnswerValue, FeedbackQuestion, FeedbackSection } from '@/api/feedback';
import { IMPORTANCE_OPTIONS, questionAnalyticsSettings } from './questionAnalyticsConfig';
import { classifyScore } from './scoreClassification';

const choices = new Set(['yes_no', 'single_choice', 'multiple_choice', 'dropdown', 'likert']);
export const isScorableQuestion = (question: FeedbackQuestion) => ['rating', 'number'].includes(question.type) || choices.has(question.type);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const percentage = (value: unknown): value is number => finite(value) && value >= 0 && value <= 100;

export const previewClass = classifyScore;

export function scoringReadiness(question: FeedbackQuestion): { state: 'ready' | 'incomplete' | 'not_scored'; label: string; message: string } {
  const settings = questionAnalyticsSettings(question);
  const incomplete = (message: string) => ({ state: 'incomplete' as const, label: 'Needs setup', message });
  if (!isScorableQuestion(question)) return { state: 'not_scored', label: 'Not scored', message: 'Written and informational answers are reviewed by a person. They do not lower the score.' };
  if (settings.scoring === 'none') return incomplete('Scoring is required before publishing. Set answer scores or choose a scoring direction.');
  if (!IMPORTANCE_OPTIONS.some(option => option.value === settings.importance)) return incomplete('Choose a valid question importance.');
  if (['rating', 'number'].includes(question.type)) {
    if (!['higher', 'lower'].includes(settings.scoring)) return incomplete('Choose Higher is better or Lower is better.');
    const min = question.type === 'number' ? settings.scoreMin : question.config.min ?? 1;
    const max = question.type === 'number' ? settings.scoreMax : question.config.max ?? 5;
    if (!finite(min) || !finite(max) || max <= min) return incomplete('Set a minimum and a maximum greater than the minimum.');
  } else {
    if (settings.scoring !== 'options') return incomplete('Set a score for each answer option.');
    const options = question.type === 'yes_no' ? ['yes', 'no'] : question.config.options || [];
    if (!options.length || options.some(option => !option.trim()) || new Set(options).size !== options.length) return incomplete('Use distinct, non-empty answer options before setting scores.');
    const missing = options.filter(option => !percentage(settings.optionScores[option]));
    if (missing.length) return incomplete(`Set a percentage from 0 to 100 for ${missing.length} ${missing.length === 1 ? 'answer' : 'answers'}. Blank is not zero.`);
    if (Object.keys(settings.optionScores).some(option => !options.includes(option))) return incomplete('Review scores after changing the answer options.');
  }
  return { state: 'ready', label: 'Ready', message: settings.includeInOverall ? 'Included in the weighted response score.' : 'Scored separately; excluded from the complete response score.' };
}

/** Staff examples only. The backend remains authoritative; this never saves answers or draws questions. */
export function previewQuestionScore(question: FeedbackQuestion, answer: FeedbackAnswerValue | undefined): number | null {
  if (scoringReadiness(question).state !== 'ready') return null;
  const settings = questionAnalyticsSettings(question);
  if (question.type === 'rating' || question.type === 'number') {
    const min = question.type === 'number' ? settings.scoreMin! : question.config.min ?? 1;
    const max = question.type === 'number' ? settings.scoreMax! : question.config.max ?? 5;
    if (!finite(answer) || (question.type === 'rating' && (answer < min || answer > max))) return null;
    const score = Math.max(0, Math.min(100, (answer - min) / (max - min) * 100));
    return settings.scoring === 'lower' ? 100 - score : score;
  }
  if (question.type === 'multiple_choice') {
    if (!Array.isArray(answer) || !answer.length || answer.some(item => typeof item !== 'string')) return null;
    const scores = [...new Set(answer)].map(option => settings.optionScores[option]);
    return scores.every(percentage) ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  }
  const key = question.type === 'yes_no' && typeof answer === 'boolean' ? answer ? 'yes' : 'no' : answer;
  const score = typeof key === 'string' ? settings.optionScores[key] : undefined;
  return percentage(score) ? score : null;
}

export function previewResponseScore(items: { key: string; question: FeedbackQuestion; answer?: FeedbackAnswerValue }[]) {
  const rows = items.map(item => {
    const settings = questionAnalyticsSettings(item.question);
    const score = previewQuestionScore(item.question, item.answer);
    const weight = IMPORTANCE_OPTIONS.find(option => option.value === settings.importance)?.weight || 2;
    return { ...item, score, weight, included: score != null && settings.includeInOverall };
  });
  const included = rows.filter(row => row.included);
  const weight = included.reduce((sum, row) => sum + row.weight, 0);
  const total = included.reduce((sum, row) => sum + row.score! * row.weight, 0);
  const score = weight ? total / weight : null;
  return { rows, score, total, weight, classification: previewClass(score), scoredQuestions: included.length };
}

export function scoringQuestions(sections: FeedbackSection[]) {
  return sections.flatMap((section, sectionIndex) => section.questions.map((question, questionIndex) => ({
    key: `${sectionIndex}:${questionIndex}`, section, sectionIndex, questionIndex, question,
    readiness: scoringReadiness(question),
  })));
}
