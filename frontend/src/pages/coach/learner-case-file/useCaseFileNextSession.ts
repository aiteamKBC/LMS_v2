import type { CaseFileHeaderSummary } from '@/features/coach/case-file/api/contracts';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCallback, useEffect, useState } from 'react';
import { readCoachJson } from '@/features/coach/case-file/api/caseFileApi';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { buildUpcomingSchedule } from './data';
import type { CaseFileUpcomingSession } from './types';

type State = { learnerId: string | null; data: CaseFileUpcomingSession | null; loading: boolean; error: string | null };

export function useCaseFileNextSession(learnerId?: string | null, enabled = true) {
  const session = useCaseFileSession();
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
    const load = session
      ? session.read<CaseFileHeaderSummary>('header-summary', {}, { signal: controller.signal, refresh: attempt > 0 }).then(summary => {
        if (summary.errors.nextSession) throw new Error(summary.errors.nextSession);
        return { event: summary.nextSession };
      })
      : readCoachJson<{ event?: CoachCalendarEvent | null }>(`/coach_api/coach/learners/${encodeURIComponent(learnerId)}/next-session`, controller.signal);
    void load.then(payload => {
        const event = payload.event || null;
        const data = event ? buildUpcomingSchedule([learnerId], [event])[0] || null : null;
        if (!controller.signal.aborted) setState({ learnerId, data, loading: false, error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({ learnerId, data: null, loading: false, error: reason instanceof Error ? reason.message : 'Unable to load the next session.' });
      });
    return () => controller.abort();
  }, [attempt, enabled, learnerId, session]);

  const current = state.learnerId === learnerId ? state : { learnerId: learnerId || null, data: null, loading: Boolean(learnerId && enabled), error: null };
  return { data: current.data, loading: current.loading, error: current.error, retry, invalidate: retry };
}
