import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { useDashboardPlan } from './useDashboardPlan';
import { dashboardPlanSubjects } from './dashboardPlan';
import { TrainingPlanDetails } from '@/pages/learner/training-plan-timeline/TrainingPlanDetails';
import styles from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

/** Independent loading keeps the existing dashboard visible while plan sources resolve. */
export function DashboardTrainingPlan({ kind, learnerId }: { kind: LearnerKind; learnerId: string }) {
  const { data, subjects: summaries, loading, error, refresh, retryContract } = useDashboardPlan(kind, learnerId);
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const initialSubjectId = params.get('subject') || '';
  const initialMonth = params.get('month') || '';
  const destination = `${kind}:${learnerId}:${initialSubjectId}:${initialMonth}`;
  const scrollDestination = `${destination}:${hash}`;
  const anchor = useRef<HTMLDivElement>(null);
  const scrolled = useRef('');
  const hasSnapshot = !!data && !!summaries;
  const subjects = useMemo(() => data && summaries ? dashboardPlanSubjects(summaries, data) : [], [data, summaries]);
  useEffect(() => {
    if (!hasSnapshot || (!initialSubjectId && hash !== '#module-timeline') || scrolled.current === scrollDestination) return;
    scrolled.current = scrollDestination;
    const target = hash === '#module-timeline' ? anchor.current?.querySelector('#module-timeline') : anchor.current;
    target?.scrollIntoView({ block: 'start' });
  }, [hasSnapshot, scrollDestination, initialSubjectId, hash]);

  return <div ref={anchor} className={styles.root}>
    {error && <div role="alert" className={styles.error}><span>Your monthly learning could not refresh. {error}</span><button onClick={refresh}>Retry monthly learning</button></div>}
    {hasSnapshot && data ? <TrainingPlanDetails key={destination} data={data} subjects={subjects} kind={kind} learnerId={learnerId}
      onRefresh={refresh} refreshing={loading} onRetryContract={retryContract} initialSubjectId={initialSubjectId} initialMonth={initialMonth} />
      : !error && <div role="status" aria-label="Loading monthly learning and coaching" className={styles.loading}>
        {[0, 1, 2].map(item => <div key={item} aria-hidden="true"><span /><span /><span /></div>)}
      </div>}
  </div>;
}
