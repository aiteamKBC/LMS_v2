import { useEffect, useState } from 'react';
import { fetchEmployerLearnerSchedule, type EmployerLearnerCard, type EmployerLearnerSchedule } from '@/api/employerPortal';
import { learnerKey, type Loadable } from './employerDashboardData';

export type JourneySchedules = Record<string, Loadable<EmployerLearnerSchedule>>;

/** Reuse the employer's authorized, read-only curriculum schedule projection. */
export function useEmployerJourneyHolidays(employerId: string, learners: EmployerLearnerCard[]) {
  const [records, setRecords] = useState<JourneySchedules>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRecords({});
    const queue = [...learners];
    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const learner = queue.shift()!;
        const key = learnerKey(learner);
        try {
          const data = await fetchEmployerLearnerSchedule(employerId, learner.kind, learner.id, controller.signal);
          if (!Array.isArray(data?.modules)) throw new Error('Schedule unavailable');
          if (!controller.signal.aborted) setRecords(current => ({ ...current, [key]: { status: 'ready', data } }));
        } catch {
          if (!controller.signal.aborted) setRecords(current => ({ ...current, [key]: { status: 'error' } }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, learners.length) }, () => worker()));
    return () => controller.abort();
  }, [employerId, learners, revision]);
  return { records, retry: () => setRevision(value => value + 1) };
}
