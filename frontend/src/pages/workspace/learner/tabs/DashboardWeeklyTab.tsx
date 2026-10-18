import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardWeeklyLearningPlan } from '../WeeklyLearningPlan';

type WeeklyContentProps = Pick<DashboardTabsProps, 'kind' | 'learnerId' | 'plan' | 'pageError' | 'initialWeeklyModuleId' | 'active'> & {
  canOpenActivities?: boolean;
};

export function DashboardWeeklyContent({ kind, learnerId, pageError, initialWeeklyModuleId, active, canOpenActivities = true }: WeeklyContentProps) {
  const showWeeklyPlan = !pageError;
  return <>
    {showWeeklyPlan && <DashboardWeeklyLearningPlan kind={kind} learnerId={learnerId} canOpenActivities={canOpenActivities}
      initialModuleId={initialWeeklyModuleId} active={active} />}
  </>;
}

export default function DashboardWeeklyTab(props: DashboardTabsProps) {
  return <DashboardWeeklyContent {...props} />;
}
