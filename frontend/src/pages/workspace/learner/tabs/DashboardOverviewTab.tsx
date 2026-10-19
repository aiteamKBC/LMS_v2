import { fetchModuleProgress, peekModuleProgress } from '@/api/moduleProgress';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardProgressStat } from '../DashboardProgressStat';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
import { DashboardActivities } from '../DashboardActivities';
import { programmeReviewProgress } from '@/pages/learner/training-plan-timeline/progress';
import styles from '../Overview.module.css';
import { OverviewCharts } from '../OverviewCharts';
import layout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';
import { useSearchParams } from 'react-router-dom';

function LegacyOverviewTab({ kind, learnerId, plan, programmeStartDate, programmeEndDate, metrics, real, canSeeNavItem, overviewExtra, pageError, learningSubjects, learningSubjectsLoading, learningSubjectsError, onRetryLearningSubjects, programmeProgress }: DashboardTabsProps) {
  const progressRead = useLiveLearnerRead(kind, learnerId,
    programmeProgress === undefined && !!real && !learningSubjectsLoading && learningSubjects !== undefined,
    fetchModuleProgress, peekModuleProgress);
  const progress = programmeProgress === undefined ? progressRead
    : { data: { modules: programmeProgress }, loading: false, error: '', refresh: () => onRetryLearningSubjects?.() };
  const awaitingProgress = !!real && learningSubjects !== undefined && !progress.data;
  const retryModules = () => { onRetryLearningSubjects?.(); if (programmeProgress === undefined) progress.refresh(); };
  const reviews = plan.data ? programmeReviewProgress(plan.data.reviews) : null;
  return <div className={styles.dashboardTabContent}>
    <div className={`${styles.metrics} ${styles.metricsInline}`}>
      <DashboardProgressStat href="/learner/attendance" label="Attendance" value={metrics.attendanceValue} summary={metrics.attendanceSummary} valueLabel="Attended" targetValue={metrics.attendanceTotalValue} targetLabel="Sessions to date" percent={metrics.attendancePercent} accent="green" loading={metrics.attendanceLoading} />
      <DashboardProgressStat href={`/learner/otjh/${kind}/${learnerId}`} label="OTJ Hours" value={metrics.otjActualValue} summary={metrics.otjSummary} valueLabel="Actual" targetValue={metrics.otjTargetValue} targetLabel="Target to date" percent={metrics.otjPercent} accent="yellow" loading={metrics.metricsLoading} />
      <DashboardProgressStat href={`/learner/ksbs/${kind}/${learnerId}`} label="KSB Progress" value={metrics.ksbValue} summary={metrics.ksbSummary} percent={metrics.ksbPercent} accent="purple" loading={metrics.metricsLoading} />
      <DashboardProgressStat href={`/learner/calendar/${kind}/${learnerId}`} label="Reviews" value={reviews ? String(reviews.completed) : '—'}
        summary={reviews ? `${reviews.completed} / ${reviews.total}` : '— / —'} valueLabel="Completed" targetValue={reviews ? String(reviews.total) : '—'}
        targetLabel="Due to date" percent={reviews?.percent ?? null} accent="yellow" loading={plan.loading && !plan.data} />
    </div>
    {overviewExtra}
    {real && <DashboardActivities kind={kind} programmeStatus={real.programmeStatus} canSeeNavItem={canSeeNavItem} />}
    <DashboardTrainingPlan kind={kind} learnerId={learnerId} plan={plan} canOpenActivities={false} showRewards={false} activityOverviewOnly overviewOnly programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} targetAsOfToday={metrics.otjTargetHours} learningSubjects={learningSubjects} programmeProgress={progress.data?.modules} learningSubjectsLoading={learningSubjectsLoading || progress.loading || awaitingProgress} learningSubjectsError={learningSubjectsError || progress.error} onRetryLearningSubjects={retryModules} pageError={pageError} />
  </div>;
}

export default function DashboardOverviewTab(props: DashboardTabsProps) {
  const [params] = useSearchParams();
  const read = props.tabData?.overview;
  if (!read) return <LegacyOverviewTab {...props} />;
  const { kind, learnerId, metrics, real, canSeeNavItem, overviewExtra, programmeStartDate, programmeEndDate } = props;
  const reviews = read.payload?.reviews;
  return <div className={styles.dashboardTabContent}>
    <div className={`${styles.metrics} ${styles.metricsInline}`}>
      <DashboardProgressStat href="/learner/attendance" label="Attendance" value={metrics.attendanceValue} summary={metrics.attendanceSummary} valueLabel="Attended" targetValue={metrics.attendanceTotalValue} targetLabel="Sessions to date" percent={metrics.attendancePercent} accent="green" loading={metrics.attendanceLoading} />
      <DashboardProgressStat href={`/learner/otjh/${kind}/${learnerId}`} label="OTJ Hours" value={metrics.otjActualValue} summary={metrics.otjSummary} valueLabel="Actual" targetValue={metrics.otjTargetValue} targetLabel="Target to date" percent={metrics.otjPercent} accent="yellow" loading={metrics.metricsLoading} />
      <DashboardProgressStat href={`/learner/ksbs/${kind}/${learnerId}`} label="KSB Progress" value={metrics.ksbValue} summary={metrics.ksbSummary} percent={metrics.ksbPercent} accent="purple" loading={metrics.metricsLoading} />
      <DashboardProgressStat href={`/learner/calendar/${kind}/${learnerId}`} label="Reviews" value={reviews ? String(reviews.completed) : '—'} summary={reviews ? `${reviews.completed} / ${reviews.total}` : '— / —'} valueLabel="Completed" targetValue={reviews ? String(reviews.total) : '—'} targetLabel="Due to date" percent={reviews?.percent ?? null} accent="yellow" loading={read.loading && !read.payload} />
    </div>
    {overviewExtra}
    {real && <DashboardActivities kind={kind} programmeStatus={real.programmeStatus} canSeeNavItem={canSeeNavItem} />}
    {read.error && <div role="alert" className={layout.error}>Your learning modules could not refresh. {read.error} <button onClick={read.refresh}>Retry learning modules</button></div>}
    {read.payload ? <OverviewCharts key={`${kind}:${learnerId}:${params.get('subject') || ''}:${params.get('month') || ''}`} payload={read.payload}
      programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} targetAsOfToday={metrics.otjTargetHours} />
      : read.loading && <div role="status" aria-label="Loading monthly learning and coaching" className={layout.loading}><div aria-hidden="true"><span /><span /><span /></div></div>}
  </div>;
}
