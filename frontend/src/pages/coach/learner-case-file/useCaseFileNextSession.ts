import { useCallback, useEffect, useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { buildUpcomingSchedule } from './data';
import type { CaseFileUpcomingSession } from './types';

type State = { learnerId: string | null; data: CaseFileUpcomingSession | null; loading: boolean; error: string | null };

export function useCaseFileNextSession(learnerId?: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ learnerId: null, data: null, loading: false, error: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !learnerId) {
      setState({ learnerId: null, data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ learnerId, data: null, loading: true, error: null });
    coachFetch(`/coach_api/coach/learners/${encodeURIComponent(learnerId)}/next-session`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { event?: CoachCalendarEvent | null; detail?: string; error?: string };
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load the next session.');
        const event = payload.event || null;
        const data = event ? buildUpcomingSchedule([learnerId], [event])[0] || null : null;
        if (!controller.signal.aborted) setState({ learnerId, data, loading: false, error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({ learnerId, data: null, loading: false, error: reason instanceof Error ? reason.message : 'Unable to load the next session.' });
      });
    return () => controller.abort();
  }, [attempt, enabled, learnerId]);

  const current = state.learnerId === learnerId ? state : { learnerId: learnerId || null, data: null, loading: Boolean(learnerId && enabled), error: null };
  return { data: current.data, loading: current.loading, error: current.error, retry, invalidate: retry };
}
