import type { FeedbackClassificationReport, FeedbackQuestionMetric } from '@/api/feedback';

export const FEEDBACK_TYPE_LABELS = {
  post_lecture: 'Live Sessions Feedback', mid_module: 'Mid-module Feedback', end_module: 'End-module Feedback',
  post_mcm_review: 'MCM Feedback', post_progress_review: 'Progress Review Feedback', post_event: 'Event Feedback',
  event_rsvp: 'Event RSVP', general: 'General Feedback',
} as const;

export function ukCalendarDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dashboardPeriod(today: string, weeks: number) {
  if (!weeks) return {};
  const first = new Date(`${today}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - weeks * 7 + 1);
  return { submittedFrom: first.toISOString().slice(0, 10), submittedTo: today };
}

export function weeklyClassifications(report: FeedbackClassificationReport) {
  const weeks = new Map<string, { week: string; positive: number; negative: number }>();
  for (const response of report.responses) {
    if (!response.submittedAt || Number.isNaN(Date.parse(response.submittedAt))) continue;
    const date = new Date(`${ukCalendarDate(new Date(response.submittedAt))}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const week = date.toISOString().slice(0, 10);
    const row = weeks.get(week) || { week, positive: 0, negative: 0 };
    if (response.classification === 'positive' || response.classification === 'negative') row[response.classification] += 1;
    weeks.set(week, row);
  }
  const ordered = [...weeks.keys()].sort();
  if (!ordered.length) return [];
  const rows = [];
  const cursor = new Date(`${ordered[0]}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= ordered[ordered.length - 1]) {
    const week = cursor.toISOString().slice(0, 10);
    rows.push(weeks.get(week) || { week, positive: 0, negative: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return rows;
}

export function rankedQuestions(questions: FeedbackQuestionMetric[], kind: 'positive' | 'negative') {
  return questions.flatMap(question => {
    const counts = question.classification;
    if (!counts) return [];
    const total = counts.positive + counts.neutral + counts.negative;
    return total && counts[kind] ? [{ question, count: counts[kind], total, rate: counts[kind] / total * 100 }] : [];
  }).sort((a, b) => b.rate - a.rate || b.count - a.count || a.question.questionId - b.question.questionId).slice(0, 5);
}

export function negativeCategories(questions: FeedbackQuestionMetric[]) {
  const groups = new Map<string, { label: string; form: string; version: number; negative: number; total: number }>();
  for (const question of questions) {
    if (!question.classification) continue;
    const key = JSON.stringify([question.formId, question.version, question.category]);
    const row = groups.get(key) || { label: question.category, form: question.formTitle, version: question.version, negative: 0, total: 0 };
    row.negative += question.classification.negative;
    row.total += question.classification.positive + question.classification.neutral + question.classification.negative;
    groups.set(key, row);
  }
  return [...groups.values()].filter(row => row.negative > 0).map(row => ({ ...row, rate: row.negative / row.total * 100 }))
    .sort((a, b) => b.rate - a.rate || b.negative - a.negative);
}
