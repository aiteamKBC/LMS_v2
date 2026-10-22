import { learningFetch } from '@/lib/personalLearning';
import type { UpcomingLearningLink } from '@/pages/learner/my-learning/LearningCatalogue';
import type { LearnerKind, LearnerDetail } from './learnerDetail';
import type { StudentActivityResponse } from './studentActivity';
import type { Subject, SubjectCardSummary, CoverMetadata } from '@/pages/learner/my-learning/learningSummary';
import type { LearningSchedule } from './learnerOverview';
import type { PlanModule, PlanSession } from './trainingPlanDashboard';
import { readLearnerJson, peekLearnerJson } from './learnerRead';

export type MyLearningCard = Pick<Subject, 'id' | 'title' | 'source' | 'moduleId' | 'previousLearningFor' | 'importedCourseRef' | 'replacementCourseRef'> & SubjectCardSummary & {
  cover?: string | null; planModule?: Omit<PlanModule, 'id' | 'title' | 'description' | 'coach_name'> | null; actualHours?: number | null;
  transferredProgress?: number; transferPending?: boolean; demoProgress?: boolean;
};
type Count = { subjects: number; total: number; completed: number; percent: number };
export type MyLearningCatalogue = {
  learner: { id: string; kind: LearnerKind; name: string; programme: string; cohort: string; group: string };
  summary: { current: Count; previous: Count; subjectCount: number };
  modules: MyLearningCard[];
  otjh: { actual: number | null; planned: number | null };
  upcoming: UpcomingLearningLink[]; hasMoreUpcoming: boolean;
};
export type MyLearningModule = {
  subjectId: string; detail: LearnerDetail; activity: StudentActivityResponse | null;
  metadata: CoverMetadata; schedule: LearningSchedule; sessions: PlanSession[];
};
const cataloguePath = (kind: LearnerKind, id: string) => `/learner_api/my-learning/${kind}/${encodeURIComponent(id)}/`;
const modulePath = (kind: LearnerKind, id: string, subject: string) => `${cataloguePath(kind, id)}modules/${encodeURIComponent(subject)}/`;

export const myLearningCatalogue = {
  read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) => {
    const result = await readLearnerJson<MyLearningCatalogue>(cataloguePath(kind, id), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (result.learner?.id !== id || result.learner.kind !== kind
      || !Array.isArray(result.modules) || !Array.isArray(result.upcoming) || !result.summary?.current || !result.summary.previous || !result.otjh) {
      throw new Error('Could not load your subjects. Please try again.');
    }
    return result;
  },
  peek: (kind: LearnerKind, id: string) => peekLearnerJson<MyLearningCatalogue>(cataloguePath(kind, id)),
};

export async function readMyLearningUpcoming(kind: LearnerKind, id: string) {
  return readLearnerJson<{ upcoming: UpcomingLearningLink[] }>(`${cataloguePath(kind,id)}upcoming/`, { ttlMs: 30_000 });
}

export const myLearningModule = {
  read: async (kind: LearnerKind, learner: string, selected: string, signal?: AbortSignal, fresh = false): Promise<MyLearningModule> => {
    const result = await readLearnerJson<MyLearningModule>(modulePath(kind, learner, selected), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!result.subjectId || String(result.detail?.id) !== learner || !Array.isArray(result.detail?.components) || !result.metadata || !result.schedule) {
      throw new Error('Could not load this subject. Please try again.');
    }
    return result;
  },
  peek: (kind: LearnerKind, learner: string, selected: string) => peekLearnerJson<MyLearningModule>(modulePath(kind, learner, selected)),
};

export async function searchMyLearning(kind: LearnerKind, id: string, term: string, signal: AbortSignal): Promise<string[]> {
  const ids: string[] = [];
  let offset: number | null = 0;
  do {
    const response = await learningFetch(`${cataloguePath(kind,id)}search/?q=${encodeURIComponent(term)}&offset=${offset}`, { signal });
    if (!response.ok) throw new Error('Could not search activities. Please try again.');
    const result = await response.json() as { matches: { id: string }[]; nextOffset: number | null };
    ids.push(...result.matches.map(match => match.id));
    if (result.nextOffset !== null && result.nextOffset <= offset) throw new Error('Invalid search response.');
    offset = result.nextOffset;
  } while (offset !== null && !signal.aborted);
  return ids;
}
