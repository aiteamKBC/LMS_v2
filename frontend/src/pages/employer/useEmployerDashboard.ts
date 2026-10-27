import { useEffect, useState } from 'react';
import { fetchEmployerDashboardMetrics, fetchEmployerLearnerAttendance, fetchEmployerProgressReviews, fetchEmployerProgressReviewSummary, type EmployerDashboardMetrics, type EmployerLearnerCard } from '@/api/employerPortal';
import { learnerKey, londonToday, progressReviews, type DashboardAttendance, type DashboardReviews, type DashboardReviewSummaries, type Loadable } from './employerDashboardData';

export function useEmployerDashboard(employerId: string, learners: EmployerLearnerCard[] | undefined, refresh: number, includeProgramme = true) {
  const [metrics, setMetrics] = useState<Loadable<EmployerDashboardMetrics>>({ status: 'loading' });
  const [homeProgressMetrics, setHomeProgressMetrics] = useState<Loadable<EmployerDashboardMetrics>>({ status: 'loading' });
  const [programmeMetrics, setProgrammeMetrics] = useState<Loadable<EmployerDashboardMetrics>>({ status: 'loading' });
  const [attendance, setAttendance] = useState<DashboardAttendance>({});
  const [reviews, setReviews] = useState<DashboardReviews>({});
  const [reviewSummaries, setReviewSummaries] = useState<DashboardReviewSummaries>({});
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setMetrics({ status: 'loading' });
    setHomeProgressMetrics({ status: 'loading' });
    setAttendance({});
    setReviews({});
    setReviewSummaries({});
    if (!learners) return () => controller.abort();
    if (!learners.length) {
      const empty = { learners: {}, asOf: '' };
      setMetrics({ status: 'ready', data: empty });
      if (includeProgramme) {
        setHomeProgressMetrics({ status: 'ready', data: empty });
        setProgrammeMetrics({ status: 'ready', data: empty });
      }
      return () => controller.abort();
    }
    if (includeProgramme) {
      setHomeProgressMetrics({ status: 'loading' });
      setProgrammeMetrics({ status: 'loading' });
    }
    if (includeProgramme) {
      // Risk status is a small saved field; render it without waiting for the
      // learner's full OTJ/module projection below.
      void fetchEmployerDashboardMetrics(employerId, signal, 'status')
        .then(data => { if (!signal.aborted) setMetrics({ status: 'ready', data }); })
        .catch(() => { if (!signal.aborted) setMetrics({ status: 'error', error: 'Learner status could not be loaded.' }); });
      // Student Home's compact summary supplies the table's OTJ ratio. Keep it
      // independent from catalogue/module completion, which the chart uses.
      void fetchEmployerDashboardMetrics(employerId, signal, 'summary')
        .then(data => { if (!signal.aborted) setHomeProgressMetrics({ status: 'ready', data }); })
        .catch(() => { if (!signal.aborted) setHomeProgressMetrics({ status: 'error' }); });
      void fetchEmployerDashboardMetrics(employerId, signal, 'programme')
        .then(data => { if (!signal.aborted) setProgrammeMetrics({ status: 'ready', data }); })
        .catch(() => { if (!signal.aborted) setProgrammeMetrics({ status: 'error' }); });
    } else {
      void fetchEmployerDashboardMetrics(employerId, signal, 'summary')
        .then(data => { if (!signal.aborted) setMetrics({ status: 'ready', data }); })
        .catch(() => { if (!signal.aborted) setMetrics({ status: 'error', error: 'Learner progress could not be loaded.' }); });
    }
    setReviews(Object.fromEntries(learners.map(learner => [learnerKey(learner), { status: 'loading' }])));
    if (includeProgramme) setReviewSummaries(Object.fromEntries(learners.map(learner => [learnerKey(learner), { status: 'loading' }])));
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
    void Promise.all(Array.from({ length: Math.min(3, learners.length) }, () => attendanceWorker()));
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
    if (includeProgramme) {
      // Resolve the home card from this month's compact calendar projection;
      // the full review list continues loading independently for the journey.
      const summaryQueue = [...learners];
      async function summaryWorker() {
        while (summaryQueue.length && !signal.aborted) {
          const learner = summaryQueue.shift()!;
          const key = learnerKey(learner);
          try {
            const result = await fetchEmployerProgressReviewSummary(
              employerId, learner.kind, learner.id, londonToday().slice(0, 7), signal,
            );
            if (!signal.aborted) setReviewSummaries(current => ({ ...current, [key]: { status: 'ready', data: progressReviews(result.events) } }));
          } catch {
            if (!signal.aborted) setReviewSummaries(current => ({ ...current, [key]: { status: 'error', error: 'Review dates could not be loaded.' } }));
          }
        }
      }
      void Promise.all(Array.from({ length: Math.min(3, learners.length) }, () => summaryWorker()));
    }
    return () => controller.abort();
  }, [employerId, learners, refresh, includeProgramme]);
  return { metrics, homeProgressMetrics, programmeMetrics, attendance, reviews, reviewSummaries };
}
