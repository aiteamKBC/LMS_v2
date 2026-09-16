import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import type { DashboardPlanState } from './useDashboardPlan';
import { dashboardPlanSubjects } from './dashboardPlan';
import { TrainingPlanDetails } from '@/pages/learner/training-plan-timeline/TrainingPlanDetails';
import { OverviewLearningPanels } from './OverviewLearningPanels';
import { DashboardRewards } from './DashboardRewards';
import styles from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

/** Independent loading keeps the existing dashboard visible while plan sources resolve. */
export function DashboardTrainingPlan({ kind, learnerId, plan, canOpenActivities = true, programmeStartDate, canOpenRewards = true }: { kind: LearnerKind; learnerId: string; plan: DashboardPlanState; canOpenActivities?: boolean; programmeStartDate?: string | null; canOpenRewards?: boolean }) {
  const { data, subjects: summaries, loading, error, refresh, retryContract, week, schedule } = plan;
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
  const weeklyFocus = canOpenActivities ? <OverviewLearningPanels kind={kind} learnerId={learnerId} week={week} schedule={schedule} /> : undefined;
  useEffect(() => {
    if (!hasSnapshot || (!initialSubjectId && hash !== '#module-timeline') || scrolled.current === scrollDestination) return;
    scrolled.current = scrollDestination;
    const target = hash === '#module-timeline' ? anchor.current?.querySelector('#module-timeline') : anchor.current;
    target?.scrollIntoView({ block: 'start' });
  }, [hasSnapshot, scrollDestination, initialSubjectId, hash]);

  return <div ref={anchor} className={styles.root}>
    {error && <div role="alert" className={styles.error}><span>Your monthly learning could not refresh. {error}</span><button onClick={refresh}>Retry monthly learning</button></div>}
    {hasSnapshot && data ? <TrainingPlanDetails key={destination} data={data} subjects={subjects} kind={kind} learnerId={learnerId}
      weeklyFocus={weeklyFocus} programmeStartDate={programmeStartDate} canOpenActivities={canOpenActivities} onRefresh={refresh} refreshing={loading} onRetryContract={retryContract} initialSubjectId={initialSubjectId} initialMonth={initialMonth} />
      : <>
        <div className={`${styles.topRow} ${weeklyFocus ? styles.withWeeklyFocus : ''}`}>
          {weeklyFocus}
          {!error && <div role="status" aria-label="Loading monthly learning and coaching" className={styles.loading}>
            <div aria-hidden="true"><span /><span /><span /></div>
          </div>}
        </div>
      </>}
    <DashboardRewards kind={kind} learnerId={learnerId} canOpenRewards={canOpenRewards} />
  </div>;
}
