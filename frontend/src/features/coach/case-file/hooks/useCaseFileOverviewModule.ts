import { useEffect, useRef, useState } from 'react';
import { useCaseFileSession } from './CaseFileSession';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

export type OverviewModuleMeasures = Pick<TrainingPlanDashboard, 'actual' | 'actualAvailable' | 'moduleProgress'> & { id: string };

export function useCaseFileOverviewModule(moduleId?: string) {
  const session = useCaseFileSession();
  const [attempt, setAttempt] = useState(0);
  const refresh = useRef(false);
  const [state, setState] = useState<{
    session: typeof session; moduleId: string; data?: OverviewModuleMeasures; error?: string;
  }>();
  useEffect(() => {
    if (!session || !moduleId) return;
    const controller = new AbortController();
    const revalidate = refresh.current;
    refresh.current = false;
    setState({ session, moduleId });
    void session.read<OverviewModuleMeasures>('overview', { moduleId }, {
      signal: controller.signal, refresh: revalidate,
    }).then(data => {
      if (data.id !== moduleId) throw new Error('Module progress did not match the selected module.');
      if (!controller.signal.aborted) setState({ session, moduleId, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ session, moduleId,
        error: error instanceof Error ? error.message : 'Unable to load module progress.' });
    });
    return () => controller.abort();
  }, [session, moduleId, attempt]);
  // Do not show the previous learner/module for even one render before the effect.
  const current = state?.session === session && state?.moduleId === moduleId ? state : undefined;
  return { data: current?.data, error: current?.error, retry: () => {
    refresh.current = true;
    setAttempt(value => value + 1);
  } };
}
