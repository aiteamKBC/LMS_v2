import { useCallback, useEffect, useRef, useState } from 'react';
import type { JourneyComponent } from '@/utils/learnerJourney';
import type { ActivityStatus } from '@/pages/coach/learner-case-file/activityState';
import { useCaseFileSession } from './CaseFileSession';

export type JourneyCounts = { componentCount: number; completedCount: number; inProgressCount: number;
  notStartedCount: number; unavailableCount: number; progressPercent: number; status: ActivityStatus; otjh: number };
export type JourneyModuleRow = JourneyCounts & { id: string; title: string; weekCount: number };
export type JourneyWeekRow = JourneyCounts & { id: string; title: string; weekNumber: number };
export type JourneyModuleDetail = JourneyModuleRow & { weeks: JourneyWeekRow[] };
export type JourneyWeekDetail = JourneyWeekRow & { moduleId: string; components: Array<JourneyComponent & { status: ActivityStatus; completedAt: string | null }> };
export type LearningPlanProjection = {
  timeline: { periodStart: string | null; periodEnd: string | null;
    modules: Array<{ id: string; title: string; progressPercent: number | null; startDate: string | null; endDate: string | null; status: ActivityStatus; weekAnchor?: string | null;
      notes?: Array<{ date: string; slotNumber: number; weekTitle?: string; holidayNote: string; holidays?: Array<{ id?: string; label: string; startDate: string; endDate?: string; type?: string; notes?: string }> }> }>;
    reviews: Array<{ id: string; date: string; type: string; title?: string; status: string; invited?: boolean }> };
  journey: { summary: { modules: number; weeks: number; components: number; completed: number; inProgress: number; notStarted: number; unavailable: number }; modules: JourneyModuleRow[] };
};

export function useLearningPlanRead<T>(section: string, params: Record<string, string> = {}, enabled = true) {
  const session = useCaseFileSession();
  const key = JSON.stringify([section, params]);
  const [revision, setRevision] = useState(0);
  const handled = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>();
  useEffect(() => {
    if (!session || !enabled) return;
    const controller = new AbortController();
    const fresh = handled.current !== revision;
    handled.current = revision;
    setState({ key });
    const [, selection] = JSON.parse(key) as [string, Record<string, string>];
    void session.read<T>(section, selection, { signal: controller.signal, refresh: fresh }).then(data => {
      if (!controller.signal.aborted) setState({ key, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'Unable to load Learning Plan.' });
    });
    return () => controller.abort();
  }, [session, section, key, enabled, revision]);
  return { ...(state?.key === key ? state : {}), loading: enabled && (!state || state.key !== key || (!state.data && !state.error)), refresh };
}
