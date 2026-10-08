import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import type { DashboardPlanState } from './useDashboardPlan';
import { dashboardPlanSubjects } from './dashboardPlan';
import { TrainingPlanDetails } from '@/pages/learner/training-plan-timeline/TrainingPlanDetails';
import { WeeklyLearningPlan } from './WeeklyLearningPlan';
import { DashboardRewards } from './DashboardRewards';
import type { ProgrammeProgressSnapshot } from '@/pages/learner/training-plan-timeline/ProgressCharts';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { subjectsFrom } from '@/pages/learner/my-learning/SubjectWorkspace';
import styles from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

/** Independent loading keeps the existing dashboard visible while plan sources resolve. */
export function DashboardTrainingPlan({ kind, learnerId, plan, canOpenActivities = true, programmeStartDate, programmeEndDate,
  canOpenRewards = true, showRewards = true, activityOverviewOnly = false, timelineOnly = false, cardsOnly = false, canOpenCalendar = true, simpleModuleOverview = false,
  monthlyOnly = false, trainingOnly = false, overviewOnly = false, showOtjChart = true, wholeProgrammeRings = false, programmeSnapshot,
  pageError, learningActivity, learnerDetail }: {
  kind: LearnerKind; learnerId: string; plan: DashboardPlanState; canOpenActivities?: boolean;
  programmeStartDate?: string | null; programmeEndDate?: string | null; canOpenRewards?: boolean;
  showRewards?: boolean; activityOverviewOnly?: boolean; timelineOnly?: boolean; cardsOnly?: boolean; canOpenCalendar?: boolean; simpleModuleOverview?: boolean;
  monthlyOnly?: boolean; trainingOnly?: boolean; overviewOnly?: boolean; showOtjChart?: boolean;
  wholeProgrammeRings?: boolean;
  programmeSnapshot?: ProgrammeProgressSnapshot; pageError?: string | null;
  learningActivity?: StudentActivityResponse | null; learnerDetail?: LearnerDetail | null;
}) {
  const { data, subjects: summaries, loading, error, refresh, retryContract, schedule } = plan;
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const initialSubjectId = params.get('subject') || '';
  const initialMonth = params.get('month') || '';
  const destination = `${kind}:${learnerId}:${initialSubjectId}:${initialMonth}`;
  const scrollDestination = `${destination}:${hash}`;
  const anchor = useRef<HTMLDivElement>(null);
  const scrolled = useRef('');
  const hasSnapshot = !!data && (!!summaries || learningActivity?.progress_basis === 'recorded_activities');
  const subjects = useMemo(() => {
    if (!data) return [];
    // Coach profiles must use the same recorded-learning projection as My Learning.
    // The overview summaries remain the fallback for learners without that source.
    if (learningActivity?.progress_basis === 'recorded_activities') {
      return subjectsFrom(learningActivity, learnerDetail || null);
    }
    return summaries ? dashboardPlanSubjects(summaries, data) : [];
  }, [data, summaries, learningActivity, learnerDetail]);
  // Once one plan dependency has failed and no complete snapshot exists, the
  // error banner is the terminal state. Do not leave a sibling weekly-plan
  // skeleton spinning indefinitely while its own retry settles.
  const terminalError = error || pageError;
  const weeklyFocus = canOpenActivities && !monthlyOnly && !trainingOnly && (hasSnapshot || !terminalError)
    ? <WeeklyLearningPlan kind={kind} learnerId={learnerId}
    schedule={schedule.data} scheduleLoading={schedule.loading} scheduleError={schedule.error || undefined} /> : undefined;
  useEffect(() => {
    if (!hasSnapshot || (!initialSubjectId && hash !== '#module-timeline') || scrolled.current === scrollDestination) return;
    scrolled.current = scrollDestination;
    const target = hash === '#module-timeline' ? anchor.current?.querySelector('#module-timeline') : anchor.current;
    target?.scrollIntoView({ block: 'start' });
  }, [hasSnapshot, scrollDestination, initialSubjectId, hash]);

  return <div ref={anchor} className={`${styles.root} ${activityOverviewOnly || timelineOnly ? styles.embeddedLearnerTheme : ''}`}>
    {error && <div role="alert" className={styles.error}><span>Your monthly learning could not refresh. {error}</span><button onClick={refresh}>Retry monthly learning</button></div>}
    {hasSnapshot && data ? <TrainingPlanDetails key={destination} data={data} subjects={subjects} kind={kind} learnerId={learnerId}
      weeklyFocus={weeklyFocus} programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} canOpenActivities={canOpenActivities} onRefresh={refresh} refreshing={loading} onRetryContract={retryContract} initialSubjectId={initialSubjectId} initialMonth={initialMonth} activityOverviewOnly={activityOverviewOnly} timelineOnly={timelineOnly} cardsOnly={cardsOnly} canOpenCalendar={canOpenCalendar} simpleModuleOverview={simpleModuleOverview} monthlyOnly={monthlyOnly} trainingOnly={trainingOnly} overviewOnly={overviewOnly} showOtjChart={showOtjChart} wholeProgrammeRings={wholeProgrammeRings} programmeSnapshot={programmeSnapshot} />
      : <>
        <div className={`${styles.topRow} ${weeklyFocus && !timelineOnly ? styles.withWeeklyFocus : ''}`}>
          {!timelineOnly && weeklyFocus}
          {!terminalError && <div role="status" aria-label="Loading monthly learning and coaching" className={styles.loading}>
            <div aria-hidden="true"><span /><span /><span /></div>
          </div>}
        </div>
      </>}
    {showRewards && <DashboardRewards kind={kind} learnerId={learnerId} canOpenRewards={canOpenRewards} />}
  </div>;
}
