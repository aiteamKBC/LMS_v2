import { useCallback, useEffect, useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import type { CoachCalendarEvent, CoachReviewGenerationIssue } from '@/pages/coach/shared/calendarEvents';
import { buildReviewGroups, buildReviewMeetingItems } from './data';
import type { CaseFileReviewGroup } from './types';

type ReviewsData = { groups: CaseFileReviewGroup[]; issues: CoachReviewGenerationIssue[] };
type State = { learnerId: string | null; attempt: number; data: ReviewsData | null; status: 'idle' | 'loading' | 'success' | 'error'; error: string | null };

export function useCaseFileReviews(learnerId?: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ learnerId: null, attempt: 0, data: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !learnerId) return;
    if (state.learnerId === learnerId && state.status === 'success' && state.attempt === attempt) return;
    const controller = new AbortController();
    setState({ learnerId, attempt, data: null, status: 'loading', error: null });
    coachFetch(`/coach_api/coach/learners/${encodeURIComponent(learnerId)}/reviews`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { events?: CoachCalendarEvent[]; reviewGenerationIssues?: CoachReviewGenerationIssue[]; detail?: string; error?: string };
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load learner reviews.');
        const items = buildReviewMeetingItems({ learnerId, learnerIdentityIds: [learnerId] }, payload.events || []);
        if (!controller.signal.aborted) setState({ learnerId, attempt, data: { groups: buildReviewGroups(items), issues: payload.reviewGenerationIssues || [] }, status: 'success', error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({ learnerId, attempt, data: null, status: 'error', error: reason instanceof Error ? reason.message : 'Unable to load learner reviews.' });
      });
    return () => controller.abort();
  }, [attempt, enabled, learnerId]); // state intentionally excluded: successful data is the page-lifetime cache.

  const current = state.learnerId === learnerId ? state : { learnerId: learnerId || null, attempt, data: null, status: enabled ? 'loading' as const : 'idle' as const, error: null };
  return { data: current.data, loading: current.status === 'loading', error: current.error, retry, invalidate: retry };
}
