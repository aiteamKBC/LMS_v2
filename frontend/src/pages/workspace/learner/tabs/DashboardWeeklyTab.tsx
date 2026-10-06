import type { DashboardTabsProps } from '../DashboardTabs';
import { WeeklyLearningPlan } from '../WeeklyLearningPlan';
import styles from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

type WeeklyContentProps = Pick<DashboardTabsProps, 'kind' | 'learnerId' | 'plan' | 'pageError'> & {
  canOpenActivities?: boolean;
};

export function DashboardWeeklyContent({ kind, learnerId, plan, pageError, canOpenActivities = true }: WeeklyContentProps) {
  const hasSnapshot = !!plan.data && !!plan.subjects;
  const showWeeklyPlan = hasSnapshot || !(plan.error || pageError);
  return <>
    {plan.error && <div role="alert" className={styles.error}>
      <span>Your monthly learning could not refresh. {plan.error}</span>
      <button onClick={plan.refresh}>Retry monthly learning</button>
    </div>}
    {showWeeklyPlan && <WeeklyLearningPlan kind={kind} learnerId={learnerId} schedule={plan.schedule.data}
      scheduleLoading={plan.schedule.loading} scheduleError={plan.schedule.error || undefined} canOpenActivities={canOpenActivities} />}
  </>;
}

export default function DashboardWeeklyTab(props: DashboardTabsProps) {
  return <DashboardWeeklyContent {...props} />;
}
