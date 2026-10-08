import { fetchModuleProgress, peekModuleProgress } from '@/api/moduleProgress';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardProgressStat } from '../DashboardProgressStat';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
import { DashboardActivities } from '../DashboardActivities';
import { programmeReviewProgress } from '@/pages/learner/training-plan-timeline/progress';
import styles from '../Overview.module.css';

export default function DashboardOverviewTab({ kind, learnerId, plan, programmeStartDate, programmeEndDate, metrics, real, canSeeNavItem, overviewExtra, pageError, learningSubjects, learningSubjectsLoading, learningSubjectsError, onRetryLearningSubjects }: DashboardTabsProps) {
  const progress = useLiveLearnerRead(kind, learnerId,
    !!real && !learningSubjectsLoading && learningSubjects !== undefined,
    fetchModuleProgress, peekModuleProgress);
  const awaitingProgress = !!real && learningSubjects !== undefined && !progress.data;
  const retryModules = () => { onRetryLearningSubjects?.(); progress.refresh(); };
  const reviews = plan.data ? programmeReviewProgress(plan.data.reviews) : null;
  return <div className={styles.dashboardTabContent}>
    <div className={`${styles.metrics} ${styles.metricsInline}`}>
      <DashboardProgressStat href="/learner/attendance" label="Attendance" value={metrics.attendanceValue} summary={metrics.attendanceSummary} valueLabel="Attended" targetValue={metrics.attendanceTotalValue} targetLabel="Sessions to date" percent={metrics.attendancePercent} accent="green" />
      <DashboardProgressStat href={`/learner/otjh/${kind}/${learnerId}`} label="OTJ Hours" value={metrics.otjActualValue} summary={metrics.otjSummary} valueLabel="Actual" targetValue={metrics.otjTargetValue} targetLabel="Target to date" percent={metrics.otjPercent} accent="yellow" />
      <DashboardProgressStat href={`/learner/ksbs/${kind}/${learnerId}`} label="KSB Progress" value={metrics.ksbValue} summary={metrics.ksbSummary} percent={metrics.ksbPercent} accent="purple" />
      <DashboardProgressStat href={`/learner/calendar/${kind}/${learnerId}`} label="Reviews" value={reviews ? String(reviews.completed) : '—'}
        summary={reviews ? `${reviews.completed} / ${reviews.total}` : '— / —'} valueLabel="Completed" targetValue={reviews ? String(reviews.total) : '—'}
        targetLabel="Due to date" percent={reviews?.percent ?? null} accent="yellow" />
    </div>
    {overviewExtra}
    {real && <DashboardActivities kind={kind} programmeStatus={real.programmeStatus} canSeeNavItem={canSeeNavItem} />}
    <DashboardTrainingPlan kind={kind} learnerId={learnerId} plan={plan} canOpenActivities={false} showRewards={false} activityOverviewOnly overviewOnly programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} targetAsOfToday={metrics.otjTargetHours} learningSubjects={learningSubjects} programmeProgress={progress.data?.modules} learningSubjectsLoading={learningSubjectsLoading || progress.loading || awaitingProgress} learningSubjectsError={learningSubjectsError || progress.error} onRetryLearningSubjects={retryModules} pageError={pageError} />
  </div>;
}
