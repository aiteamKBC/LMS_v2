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
import type { TeachingActivities } from '@/pages/learner/my-learning/teachingActivity';
import type { ProgressMetric } from './learnerMetrics';

export type MyLearningCard = Pick<Subject, 'id' | 'title' | 'source' | 'moduleId' | 'previousLearningFor' | 'importedCourseRef' | 'replacementCourseRef' | 'legacyProgressReference'> & SubjectCardSummary & {
  cover?: string | null; planModule?: Omit<PlanModule, 'id' | 'title' | 'description' | 'coach_name'> | null; actualHours?: number | null;
  transferredProgress?: number; transferPending?: boolean; demoProgress?: boolean;
  ksbProgress?: ProgressMetric;
};
type Count = { subjects: number; total: number; completed: number; percent: number };
export type MyLearningCatalogue = {
  learner: { id: string; kind: LearnerKind; name: string; programme: string; cohort: string; group: string };
  summary: { current: Count; previous: Count; subjectCount: number };
  modules: MyLearningCard[];
  moduleActivity?: TeachingActivities;
  otjh: { actual: number | null; planned: number | null };
  upcoming: UpcomingLearningLink[]; hasMoreUpcoming: boolean;
};
export type MyLearningModule = {
  subjectId: string; detail: LearnerDetail; activity: StudentActivityResponse | null;
  metadata: CoverMetadata; schedule: LearningSchedule; sessions: PlanSession[];
};
const cataloguePath = (kind: LearnerKind, id: string) => `/learner_api/my-learning/${kind}/${encodeURIComponent(id)}/`;
const modulePath = (kind: LearnerKind, id: string, subject: string) => `${cataloguePath(kind, id)}modules/${encodeURIComponent(subject)}/`;

function validCatalogue(result: MyLearningCatalogue | null | undefined, kind: LearnerKind, id: string): result is MyLearningCatalogue {
  return Boolean(result && result.learner?.id === id && result.learner.kind === kind
    && Array.isArray(result.modules) && Array.isArray(result.upcoming)
    && result.summary?.current && result.summary.previous && result.otjh);
}

function validModule(result: MyLearningModule | null | undefined, learner: string): result is MyLearningModule {
  return Boolean(result?.subjectId && String(result.detail?.id) === learner
    && Array.isArray(result.detail?.components) && result.metadata && result.schedule);
}

export const myLearningCatalogue = {
  read: async (kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false, planOnly = false) => {
    const result = await readLearnerJson<MyLearningCatalogue>(cataloguePath(kind, id) + (planOnly ? '?plan=1' : ''), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!validCatalogue(result, kind, id)) {
      throw new Error('Could not load your subjects. Please try again.');
    }
    return result;
  },
  peek: (kind: LearnerKind, id: string, planOnly = false) => {
    const result = peekLearnerJson<MyLearningCatalogue>(cataloguePath(kind, id) + (planOnly ? '?plan=1' : ''));
    return validCatalogue(result, kind, id) ? result : undefined;
  },
};

export function useMyLearningCatalogue(kind?: LearnerKind, id?: string, enabled = true, planOnly = false) {
  const identity = id && planOnly ? JSON.stringify([id, 'plan']) : id;
  const read = useCallback((kind: LearnerKind, identity: string, signal?: AbortSignal, fresh = false) => myLearningCatalogue.read(kind, planOnly ? JSON.parse(identity)[0] : identity, signal, fresh, planOnly), [planOnly]);
  const peek = useCallback((kind: LearnerKind, identity: string) => myLearningCatalogue.peek(kind, planOnly ? JSON.parse(identity)[0] : identity, planOnly), [planOnly]);
  return useLiveLearnerRead(kind, identity, enabled, read, peek);
}

/** Include the selected subject in both hook state and transport cache identity. */
export function useMyLearningModule(kind?: LearnerKind, id?: string, subject?: string | null, planOnly = false, activeOnly = true) {
  const key = id && subject ? JSON.stringify([id, subject, planOnly, activeOnly]) : undefined;
  const read = useCallback(async (readKind: LearnerKind, identity: string, signal?: AbortSignal, fresh = false) => {
    const [learner, selected, planOnly, activeOnly] = JSON.parse(identity) as [string, string, boolean, boolean];
    const result = await readLearnerJson<MyLearningModule>(modulePath(readKind, learner, selected) + (planOnly ? `?plan=1&planStatus=${activeOnly ? 'active' : 'all'}` : ''), { signal, revalidate: fresh, ttlMs: 30_000 });
    if (!validModule(result, learner) || (planOnly && !selected.startsWith('activity:') && result.subjectId !== (selected.startsWith('current:') ? selected : `current:${selected}`))) {
      throw new Error('Could not load this subject. Please try again.');
    }
    return result;
  }, []);
  const peek = useCallback((readKind: LearnerKind, identity: string) => {
    const [learner, selected, planOnly, activeOnly] = JSON.parse(identity) as [string, string, boolean, boolean];
    const result = peekLearnerJson<MyLearningModule>(modulePath(readKind, learner, selected) + (planOnly ? `?plan=1&planStatus=${activeOnly ? 'active' : 'all'}` : ''));
    return validModule(result, learner) && (!planOnly || selected.startsWith('activity:') || result.subjectId === (selected.startsWith('current:') ? selected : `current:${selected}`)) ? result : undefined;
  }, []);
  return useLiveLearnerRead(kind, key, !!key, read, peek);
}

/** Debounce activity search, abort superseded requests and hide stale identities. */
export function useMyLearningSearch(kind: LearnerKind | undefined, id: string | undefined, query: string, enabled: boolean, planOnly = false) {
  const term = query.trim();
  const key = JSON.stringify([kind,id,term,planOnly]);
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
          const response = await learningFetch(`${cataloguePath(kind,id)}search/?q=${encodeURIComponent(term)}&offset=${offset}${planOnly ? '&plan=1' : ''}`, { signal: controller.signal });
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
  }, [kind,id,term,key,enabled,attempt,planOnly]);
  return { ...(state.key === key ? state : { ids: [], error: '', loading: !!term && enabled }), retry: () => setAttempt(value => value+1) };
}

export async function readMyLearningUpcoming(kind: LearnerKind, id: string, planOnly = false) {
  return readLearnerJson<{ upcoming: UpcomingLearningLink[] }>(`${cataloguePath(kind,id)}upcoming/${planOnly ? '?plan=1' : ''}`, { ttlMs: 30_000 });
}
