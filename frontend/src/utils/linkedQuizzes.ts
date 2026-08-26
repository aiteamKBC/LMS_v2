import type { LearnerDetail, LearnerQuizAttempt } from '@/api/learnerDetail';

export interface LinkedQuiz {
  quizId: number;
  name: string;        // detail part of the component title
  module: string | null;
  week: string | null;
  questions: number | null;
  attempts: LearnerQuizAttempt[];
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
