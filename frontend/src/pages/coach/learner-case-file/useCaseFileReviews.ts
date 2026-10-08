import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { caseFileSectionRead } from '@/features/coach/case-file/api/caseFileApi';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { useCoachViewAs } from '@/hooks/useCoachViewAs';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { nextReviewMeetings } from './nextReviewMeetings';

export type ReviewRow = {
  id: string; type: 'progress-review' | 'mcr' | 'review'; title: string;
  plannedDate: string | null; scheduledDate: string | null; scheduledTime: string | null;
  completedDate: string | null; status: CoachCalendarEvent['status']; reviewer: string;
};
export type ReviewsData = {
  summary: { total: number; progressReviews: number; monthlyCoachingMeetings: number; completed: number; upcoming: number };
  reviews: ReviewRow[];
  reviewGenerationIssues?: { code: string }[];
};
export function useCaseFileReviews(learnerId?: string | null, enabled = true, requested = true) {
  const session = useCaseFileSession();
  const coach = useCoachIdentity();
  const selected = useCoachViewAs();
  const scope = JSON.stringify([coach.email.toLowerCase(), selected?.adminEmail || '', selected?.email || '']);
  const read = useCallback(<T,>(section: string, params: Record<string, string> = {}, options = {}) => session
    ? session.read<T>(section, params, options)
    : caseFileSectionRead<T>(scope, learnerId || '', section, params, options), [session, scope, learnerId]);
  const appliedAttempt = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ identity: string; data: ReviewsData | null; loading: boolean; error: string | null }>({ identity: '', data: null, loading: false, error: null });
  const identity = `${scope}:${learnerId}`;
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled || !learnerId || !requested) return;
    const controller = new AbortController();
    setState(previous => ({ identity, data: previous.identity === identity ? previous.data : null, loading: true, error: null }));
    const refresh = attempt !== appliedAttempt.current;
    appliedAttempt.current = attempt;
    void read<ReviewsData>('reviews', {}, { signal: controller.signal, refresh }).then(data => {
      if (!controller.signal.aborted) setState({ identity, data, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ identity, data: null, loading: false, error: error instanceof Error ? error.message : 'Unable to load learner reviews.' });
    });
    return () => controller.abort();
  }, [attempt, enabled, identity, learnerId, read, requested]);
  const current = state.identity === identity ? state : { data: null, loading: enabled && requested, error: null };
  const nextMeetings = useMemo(() => nextReviewMeetings((current.data?.reviews || []).map(row => ({
    ...row, learnerId: learnerId || '', source: row.type, reviewTypeName: '', reviewTypeCode: null,
  } as unknown as CoachCalendarEvent)), learnerId || ''), [current.data, learnerId]);
  return { data: current.data, nextMeetings, loading: current.loading, error: current.error, retry, invalidate: retry };
}
