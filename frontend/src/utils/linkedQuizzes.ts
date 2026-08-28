import type { LearnerDetail, LearnerQuizAttempt } from '@/api/learnerDetail';

export interface LinkedQuiz {
  quizId: number;
  name: string;        // detail part of the component title
  module: string | null;
  week: string | null;
  questions: number | null;
  attempts: LearnerQuizAttempt[];
}

/** Split an imported week label such as "Week 1 3/3/2026" into the label and
 * its trailing delivery date. Older plans store both values in the week name,
 * so the learner table needs to separate them for a clearer Date column. */
export function splitLinkedQuizWeek(value: string | null): { label: string | null; date: string | null } {
  const week = value?.trim();
  if (!week) return { label: null, date: null };

  const match = week.match(/^(.*?)\s+(\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))$/);
  if (!match) return { label: week, date: null };

  return { label: match[1].trim() || null, date: match[2] };
}

/** Derive the learner's linked quizzes (from plan components) + their attempts.
 * Shared by the Quizzes tab of My Learning and the legacy RealQuizzesView. */
export function buildLinkedQuizzes(real: LearnerDetail | null): LinkedQuiz[] {
  if (!real) return [];
  const byQuiz = new Map<number, LinkedQuiz>();
  for (const c of real.components) {
    if (!c.isQuiz || !c.quizMeta?.quizId) continue;
    const quizId = c.quizMeta.quizId;
    if (byQuiz.has(quizId)) continue;
    // Component title is "Quiz · <name>" — surface the detail part.
    const detail = c.component.includes('·') ? c.component.split('·').slice(1).join('·').trim() : c.component;
    byQuiz.set(quizId, {
      quizId,
      name: detail || c.component,
      module: c.module,
      week: c.week,
      questions: c.quizMeta.questions,
      attempts: real.quizAttempts.filter((a) => a.quizId === quizId),
    });
  }
  return Array.from(byQuiz.values());
}
