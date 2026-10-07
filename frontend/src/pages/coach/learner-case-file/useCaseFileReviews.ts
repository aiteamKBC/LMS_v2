import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readCoachJson } from '@/features/coach/case-file/api/caseFileApi';
import type { CoachCalendarEvent, CoachReviewGenerationIssue } from '@/pages/coach/shared/calendarEvents';
import { buildReviewGroups, buildReviewMeetingItems } from './data';
import type { CaseFileReviewGroup } from './types';
import { nextReviewMeetings } from './nextReviewMeetings';

type ReviewsData = { groups: CaseFileReviewGroup[]; issues: CoachReviewGenerationIssue[]; events: CoachCalendarEvent[] };
type State = { learnerId: string | null; attempt: number; data: ReviewsData | null; status: 'idle' | 'loading' | 'success' | 'error'; error: string | null };

export function useCaseFileReviews(learnerId?: string | null, enabled = true, requested = true) {
  const session = useCaseFileSession();
  const [rowsActivated, setRowsActivated] = useState(requested);
  useEffect(() => { if (requested) setRowsActivated(true); }, [requested]);
  const completed = useRef<{ learnerId: string; attempt: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ learnerId: null, attempt: 0, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !learnerId || (session && !rowsActivated)) return;
    if (!session && completed.current?.learnerId === learnerId && completed.current.attempt === attempt) return;
    const controller = new AbortController();
    setState({ learnerId, attempt, data: null, status: 'loading', error: null });
    const load = session
      ? session.read<{ events?: CoachCalendarEvent[]; reviewGenerationIssues?: CoachReviewGenerationIssue[] }>('reviews', { resource: 'rows' }, { signal: controller.signal, refresh: attempt > 0 })
      : readCoachJson<{ events?: CoachCalendarEvent[]; reviewGenerationIssues?: CoachReviewGenerationIssue[] }>(`/coach_api/coach/learners/${encodeURIComponent(learnerId)}/reviews`, controller.signal);
    void load.then(payload => {
        const items = buildReviewMeetingItems({ learnerId, learnerIdentityIds: [learnerId] }, payload.events || []);
        if (!controller.signal.aborted) { completed.current = { learnerId, attempt }; setState({ learnerId, attempt, data: { groups: buildReviewGroups(items), issues: payload.reviewGenerationIssues || [], events: payload.events || [] }, status: 'success', error: null }); }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({
          learnerId, attempt, data: null, status: 'error',
          error: reason instanceof Error ? reason.message : 'Unable to load learner reviews.',
        });
      });
    return () => controller.abort();
  }, [attempt, enabled, learnerId, session, rowsActivated]); // state intentionally excluded: successful data is the page-lifetime cache.

  const current = state.learnerId === learnerId ? state : { learnerId: learnerId || null, attempt, data: null, status: enabled && (!session || rowsActivated) ? 'loading' as const : 'idle' as const, error: null };
  return { data: current.data, nextMeetings: nextReviewMeetings(current.data?.events || [], learnerId || ''), loading: current.status === 'loading', error: current.error, retry, invalidate: retry };
}
