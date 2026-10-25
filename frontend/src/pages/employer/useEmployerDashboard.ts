import { useEffect, useState } from 'react';
import { fetchEmployerDashboardMetrics, fetchEmployerLearnerAttendance, fetchEmployerProgressReviews, type EmployerDashboardMetrics, type EmployerLearnerCard } from '@/api/employerPortal';
import { learnerKey, progressReviews, type DashboardAttendance, type DashboardReviews, type Loadable } from './employerDashboardData';

export function useEmployerDashboard(employerId: string, learners: EmployerLearnerCard[] | undefined, refresh: number, includeProgramme = true) {
  const [metrics, setMetrics] = useState<Loadable<EmployerDashboardMetrics>>({ status: 'loading' });
  const [programmeMetrics, setProgrammeMetrics] = useState<Loadable<EmployerDashboardMetrics>>({ status: 'loading' });
  const [attendance, setAttendance] = useState<DashboardAttendance>({});
  const [reviews, setReviews] = useState<DashboardReviews>({});
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setProgrammeMetrics({ status: 'loading' });
    if (includeProgramme && learners?.length) {
      void fetchEmployerDashboardMetrics(employerId, signal, 'programme')
        .then(data => { if (!signal.aborted) setProgrammeMetrics({ status: 'ready', data }); })
        .catch(() => { if (!signal.aborted) setProgrammeMetrics({ status: 'error' }); });
    }
    return () => controller.abort();
  }, [employerId, learners, refresh, includeProgramme]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setMetrics({ status: 'loading' });
    setAttendance({});
    setReviews({});
    if (!learners) return () => controller.abort();
    if (!learners.length) {
      setMetrics({ status: 'ready', data: { learners: {}, asOf: '' } });
      return () => controller.abort();
    }
    void fetchEmployerDashboardMetrics(employerId, signal, 'summary')
      .then(data => { if (!signal.aborted) setMetrics({ status: 'ready', data }); })
      .catch(() => { if (!signal.aborted) setMetrics({ status: 'error', error: 'Learner progress could not be loaded.' }); });
    setReviews(Object.fromEntries(learners.map(learner => [learnerKey(learner), { status: 'loading' }])));
    setAttendance(Object.fromEntries(learners.map(learner => [learnerKey(learner), { status: 'loading' }])));
    // Publish each register as it arrives. A slow/failed learner must not hold
    // saved hours, risk statuses, or the other learners' attendance hostage.
    const attendanceQueue = [...learners];
    async function attendanceWorker() {
      while (attendanceQueue.length && !signal.aborted) {
        const learner = attendanceQueue.shift()!;
        const key = learnerKey(learner);
        try {
          const result = await fetchEmployerLearnerAttendance(employerId, learner.kind, learner.id, signal);
          if (!signal.aborted) setAttendance(current => ({ ...current, [key]: { status: 'ready', data: result.attendance } }));
        } catch {
          if (!signal.aborted) setAttendance(current => ({ ...current, [key]: { status: 'error', error: 'Attendance could not be loaded.' } }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(2, learners.length) }, () => attendanceWorker()));
    // Bound concurrent review reads; one failed learner must not hide everyone else.
    const queue = [...learners];
    async function worker() {
      while (queue.length && !signal.aborted) {
        const learner = queue.shift()!;
        const key = learnerKey(learner);
        try {
          const result = await fetchEmployerProgressReviews(employerId, learner.kind, learner.id, signal);
          if (!signal.aborted) setReviews(current => ({ ...current, [key]: { status: 'ready', data: progressReviews(result.events) } }));
        } catch {
          if (!signal.aborted) setReviews(current => ({ ...current, [key]: { status: 'error', error: 'Reviews could not be loaded.' } }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, learners.length) }, () => worker()));
    return () => controller.abort();
  }, [employerId, learners, refresh]);
  return { metrics, programmeMetrics, attendance, reviews };
}
