import { useEffect, useState } from 'react';
import { useCaseFileSession } from './CaseFileSession';
export type CaseFileOverview = {
  wholeProgrammeProgress: {
    overall: { completed: number; total: number; percent: number | null };
    attendance: { present: number | null; sessions: number | null; percent: number | null };
    otjh: { actual: number | null; targetToDate: number | null; planned: number | null; percent: number | null };
    ksb: { completed: number; total: number; percent: number | null };
  };
  programmeProgress: { id: string; title: string; percent: number | null }[];
};

export function useCaseFileOverview() {
  const session = useCaseFileSession();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ data?: CaseFileOverview; error?: string }>({});
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setState({});
    void session.read<CaseFileOverview>('overview', {}, { signal: controller.signal, refresh: attempt > 0 }).then(data => {
      if (!controller.signal.aborted) setState({ data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Unable to load overview.' });
    });
    return () => controller.abort();
  }, [session, attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}
