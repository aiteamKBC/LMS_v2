import { useCallback, useEffect, useState } from 'react';
import { learningFetch } from '@/lib/personalLearning';
import type { UpcomingLearningLink } from '@/pages/learner/my-learning/LearningCatalogue';
import type { LearnerKind, LearnerDetail } from './learnerDetail';
import type { StudentActivityResponse } from './studentActivity';
import type { Subject, SubjectCardSummary, CoverMetadata } from '@/pages/learner/my-learning/learningSummary';
import type { LearningSchedule } from './learnerOverview';
import type { PlanModule, PlanSession } from './trainingPlanDashboard';
import { readLearnerJson, peekLearnerJson } from './learnerRead';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';

export type MyLearningCard = Pick<Subject, 'id' | 'title' | 'source' | 'moduleId' | 'previousLearningFor' | 'importedCourseRef' | 'replacementCourseRef'> & SubjectCardSummary & {
  cover?: string | null; planModule?: Omit<PlanModule, 'id' | 'title' | 'description' | 'coach_name'> | null; actualHours?: number | null;
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

export function useMyLearningCatalogue(kind?: LearnerKind, id?: string, enabled = true) {
  return useLiveLearnerRead(kind, id, enabled, myLearningCatalogue.read, myLearningCatalogue.peek);
}

/** Include the selected subject in both hook state and transport cache identity. */
export function useMyLearningModule(kind?: LearnerKind, id?: string, subject?: string | null) {
  const key = id && subject ? JSON.stringify([id, subject]) : undefined;
  const read = useCallback(async (readKind: LearnerKind, identity: string, signal?: AbortSignal, fresh = false) => {
    const [learner, selected] = JSON.parse(identity) as [string, string];
    const result = await readLearnerJson<MyLearningModule>(modulePath(readKind, learner, selected), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!result.subjectId || String(result.detail?.id) !== learner || !Array.isArray(result.detail?.components) || !result.metadata || !result.schedule) {
      throw new Error('Could not load this subject. Please try again.');
    }
    return result;
  }, []);
  const peek = useCallback((readKind: LearnerKind, identity: string) => {
    const [learner, selected] = JSON.parse(identity) as [string, string];
    return peekLearnerJson<MyLearningModule>(modulePath(readKind, learner, selected));
  }, []);
  return useLiveLearnerRead(kind, key, !!key, read, peek);
}

/** Debounce activity search, abort superseded requests and hide stale identities. */
export function useMyLearningSearch(kind: LearnerKind | undefined, id: string | undefined, query: string, enabled: boolean) {
  const term = query.trim();
  const key = JSON.stringify([kind,id,term]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; ids: string[]; error: string; loading: boolean }>({ key: '', ids: [], error: '', loading: false });
  useEffect(() => {
    if (!enabled || !kind || !id || !term) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ key, ids: [], error: '', loading: true });
      void (async () => {
        const ids: string[] = [];
        let offset: number | null = 0;
        do {
          const response = await learningFetch(`${cataloguePath(kind,id)}search/?q=${encodeURIComponent(term)}&offset=${offset}`, { signal: controller.signal });
          if (!response.ok) throw new Error('Could not search activities. Please try again.');
          const result = await response.json() as { matches: { id: string }[]; nextOffset: number | null };
          ids.push(...result.matches.map(match => match.id));
          if (result.nextOffset !== null && result.nextOffset <= offset) throw new Error('Invalid search response.');
          offset = result.nextOffset;
        } while (offset !== null && !controller.signal.aborted);
        if (!controller.signal.aborted) setState({ key, ids, error: '', loading: false });
      })().catch(error => {
        if (!controller.signal.aborted) setState({ key, ids: [], error: String(error.message), loading: false });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind,id,term,key,enabled,attempt]);
  return { ...(state.key === key ? state : { ids: [], error: '', loading: !!term && enabled }), retry: () => setAttempt(value => value+1) };
}

export async function readMyLearningUpcoming(kind: LearnerKind, id: string) {
  return readLearnerJson<{ upcoming: UpcomingLearningLink[] }>(`${cataloguePath(kind,id)}upcoming/`, { ttlMs: 30_000 });
}
