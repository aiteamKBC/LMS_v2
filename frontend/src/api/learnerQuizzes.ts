import type { LearnerDetail, LearnerKind } from './learnerDetail';
import { peekLearnerJson, readLearnerJson } from './learnerRead';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';

export type LearnerQuizList = Pick<LearnerDetail, 'id' | 'name' | 'programme' | 'cohort' | 'components' | 'quizAttempts'>;
const path = (kind: LearnerKind, id: string) => `/learner_api/learner-detail/${kind}/${encodeURIComponent(id)}/?content=quiz-list`;

function valid(result: LearnerQuizList | null | undefined, id: string): result is LearnerQuizList {
  return !!result && String(result.id) === id && Array.isArray(result.components) && Array.isArray(result.quizAttempts);
}

const reader = {
  read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) => {
    const result = await readLearnerJson<LearnerQuizList>(path(kind, id), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!valid(result, id)) throw new Error('Could not load your quizzes. Please try again.');
    return result;
  },
  peek: (kind: LearnerKind, id: string) => {
    const result = peekLearnerJson<LearnerQuizList>(path(kind, id));
    return valid(result, id) ? result : undefined;
  },
};

export function useLearnerQuizzes(kind?: LearnerKind, id?: string, enabled = true) {
  return useLiveLearnerRead(kind, id, enabled, reader.read, reader.peek);
}
