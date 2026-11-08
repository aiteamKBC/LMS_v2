import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { AuthContext } from '@/hooks/useAuth.helpers';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import type { LearnerKind } from '@/api/learnerDetail';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';
import { fetchMonthlyAssignmentDetail, fetchMonthlySubmission, type MonthlyAssignmentDetail, type MonthlySubmissionData } from '@/api/monthlySubmission';
import type { AssignmentSource } from './model';

/** A focus or visibility return re-reads only after this long (or after an error). */
export const MONTHLY_SUBMISSION_FRESH_MS = 30_000;

export type MonthlySubmissionLearner = AssignmentSource & { id: string; name: string };

type ListState = {
  identity: string; data: MonthlySubmissionData | null; error: string | null; loading: boolean; loadedAt: number;
};

/**
 * Monthly Submission's assignment rows. Staff inside a coach case file keep
 * their existing session.detail() read, which already carries every field, so
 * `includesDetails` tells the card not to fetch the selected assignment again.
 */
export function useMonthlySubmission(kind?: string, id?: string) {
  const session = useCaseFileSession();
  const preview = useLearnerDetailParam(kind, id, true, Boolean(session));
  const own = useMonthlySubmissionList(kind, id, !session);
  if (session) {
    return { real: preview.real as MonthlySubmissionLearner | null, loading: preview.loading,
      loadError: preview.loadError, refresh: preview.refresh, includesDetails: true };
  }
  return { ...own, includesDetails: false };
}

function useMonthlySubmissionList(kind: string | undefined, id: string | undefined, enabled: boolean) {
  const account = useContext(AuthContext)?.auth.account;
  const accountKey = JSON.stringify([account?.id, account?.role, account?.access, account?.subjectType, account?.subjectId, account?.learnerType]);
  const identity = enabled && id && (kind === 'commercial' || kind === 'apprenticeship')
    ? JSON.stringify([kind, id, accountKey]) : null;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<ListState | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const refresh = useCallback(() => setTick(value => value + 1), []);

  useEffect(() => {
    if (!identity || !id) return;
    const controller = new AbortController();
    // Keep the rows on screen while they refresh; a new identity starts empty.
    setState(previous => previous?.identity === identity
      ? { ...previous, error: null, loading: true } : { identity, data: null, error: null, loading: true, loadedAt: 0 });
    fetchMonthlySubmission(kind as LearnerKind, id, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ identity, data, error: null, loading: false, loadedAt: Date.now() }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Could not load your monthly assignments.';
        setState(previous => previous?.identity === identity
          ? { ...previous, error: message, loading: false } : { identity, data: null, error: message, loading: false, loadedAt: 0 });
      });
    return () => controller.abort();
  }, [identity, kind, id, tick]);

  useEffect(() => {
    if (!identity) return;
    // A save or submission anywhere in this tab invalidates learner reads.
    const unsubscribe = subscribeLearnerReadInvalidation(refresh);
    let lastReturn = 0;
    const onReturn = () => {
      // Browsers can emit focus and visibilitychange together.
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn < 1000) return;
      const current = latest.current?.identity === identity ? latest.current : null;
      if (current && (current.loading || (!current.error && Date.now() - current.loadedAt < MONTHLY_SUBMISSION_FRESH_MS))) return;
      lastReturn = Date.now();
      refresh();
    };
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [identity, refresh]);

  const current = identity && state?.identity === identity ? state : null;
  const data = current?.data ?? null;
  const real = useMemo<MonthlySubmissionLearner | null>(() => data ? {
    id: data.learner.id, name: data.learner.name, components: data.components,
    componentMarkingStatus: data.componentMarkingStatus, videoProgress: data.videoProgress,
    componentProgress: data.componentProgress,
  } : null, [data]);
  return { real, loading: Boolean(identity) && !data && (current?.loading ?? true),
    loadError: current?.error ?? null, refresh };
}

type DetailState = { key: string; data: MonthlyAssignmentDetail | null; error: string | null };

/** The selected assignment's brief, topics, files and KSBs, read on selection. */
export function useMonthlyAssignmentDetail(kind: LearnerKind, learnerId: string, componentId: string, enabled: boolean) {
  const key = enabled ? JSON.stringify([kind, learnerId, componentId]) : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState | null>(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setState(previous => previous?.key === key && previous.data ? previous : { key, data: null, error: null });
    // A retry bypasses the 30s snapshot; a reselection within it reuses the read.
    fetchMonthlyAssignmentDetail(kind, learnerId, componentId, controller.signal, attempt > 0)
      .then(data => { if (!controller.signal.aborted) setState({ key, data, error: null }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ key, data: null, error: error instanceof Error ? error.message : 'Could not load this assignment.' });
        }
      });
    return () => controller.abort();
  }, [key, kind, learnerId, componentId, attempt]);
  const current = key && state?.key === key ? state : null;
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { data: current?.data ?? null, error: current?.error ?? null, retry };
}
