import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardWeeklyLearningPlan } from '../WeeklyLearningPlan';

type WeeklyContentProps = Pick<DashboardTabsProps, 'kind' | 'learnerId' | 'plan' | 'pageError' | 'initialWeeklyModuleId'> & {
  canOpenActivities?: boolean;
};

export function DashboardWeeklyContent({ kind, learnerId, plan, pageError, initialWeeklyModuleId, canOpenActivities = true }: WeeklyContentProps) {
  const showWeeklyPlan = !pageError;
  return <>
    {showWeeklyPlan && <DashboardWeeklyLearningPlan kind={kind} learnerId={learnerId} schedule={plan.schedule.data}
      scheduleLoading={plan.schedule.loading} scheduleError={plan.schedule.error || undefined} canOpenActivities={canOpenActivities}
      initialModuleId={initialWeeklyModuleId} />}
  </>;
}

export default function DashboardWeeklyTab(props: DashboardTabsProps) {
  return <DashboardWeeklyContent {...props} />;
}
