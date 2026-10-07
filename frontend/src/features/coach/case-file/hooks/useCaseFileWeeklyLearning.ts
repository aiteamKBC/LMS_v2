import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanSlotHoliday } from '@/api/trainingPlanDashboard';
import { useCaseFileSession } from './CaseFileSession';

export type WeeklyLearningWeek = {
  id: string; moduleId: string; moduleTitle: string; weekId?: string; weekNumber: number; slotNumber: number;
  title: string; startDate: string; endDate: string; status: 'past' | 'current' | 'upcoming'; progress: number;
  completedActivities?: number; totalActivities?: number;
  kind: 'live-session' | 'reading-week'; attended: boolean | null;
  sessionState: 'attended' | 'missed' | 'upcoming' | 'live' | 'unscheduled' | 'unmarked' | 'cancelled'; holidayNote: string; holidays: PlanSlotHoliday[];
};
export type WeeklyLearningResponse = {
  weeks: WeeklyLearningWeek[];
  selectedWeek: (WeeklyLearningWeek & {
    summary: { completedActivities: number; totalActivities: number; progress: number; ksbCount: number;
      achievedKsbCount: number; otjhHours: number | null; plannedOtjhHours: number; untimedActivities: number };
    liveSession: { id: string; title: string; date: string; startTime: string; endTime: string | null;
      start: string; durationMinutes: number | null; status: string; sessionState?: WeeklyLearningWeek['sessionState']; attended: boolean | null; joinUrl: string | null } | null;
    activities: { id: string; title: string; type: string; completed: boolean; isQuiz: boolean;
      status: 'completed' | 'in-progress' | 'not-started'; expectedHours: number | null; durationMinutes: number | null;
      quizDuration: number | null; quizTimeUnit: string | null; ksbCodes: string[] }[];
  }) | null;
};

export function useCaseFileWeeklyLearning(week?: string) {
  const session = useCaseFileSession();
  const [revision, setRevision] = useState(0);
  const handled = useRef(0);
  const [state, setState] = useState<{ key: string; data?: WeeklyLearningResponse; error?: string }>();
  const key = `${session?.learnerId}:${week || ''}`;
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const fresh = handled.current !== revision;
    handled.current = revision;
    setState({ key, data: fresh ? undefined : session.peekWeeklyLearning?.<WeeklyLearningResponse>(week) });
    void session.read<WeeklyLearningResponse>('weekly-learning', week ? { week } : {}, { signal: controller.signal, refresh: fresh })
      .then(data => { if (!controller.signal.aborted) setState({ key, data }); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setState({ key, error: reason instanceof Error ? reason.message : 'Could not load weekly learning.' }); });
    return () => controller.abort();
  }, [session, week, revision, key]);
  const cached = session?.peekWeeklyLearning?.<WeeklyLearningResponse>(week);
  const result = state?.key === key ? state : { data: cached, error: undefined };
  useEffect(() => {
    const data = result.data;
    if (!session || !data?.selectedWeek) return;
    const index = data.weeks.findIndex(candidate => candidate.id === data.selectedWeek?.id);
    const next = index >= 0 ? data.weeks[index + 1] : undefined;
    // Only the immediate neighbour, never scan ahead or chain from a prefetch.
    const supported = next && (next.weekId || next.totalActivities || next.kind === 'reading-week'
      || next.holidays.length || next.sessionState !== 'unscheduled');
    if (!supported || next.id === data.selectedWeek.id || session.peekWeeklyLearning?.(next.id)) return;
    // Failure stays silent; foreground navigation retries through the same cache.
    void session.read('weekly-learning', { week: next.id }).catch(() => {});
  }, [session, result.data]);
  return { ...result, refresh };
}
