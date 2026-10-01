import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
export default function DashboardMonthlyTab({ kind, learnerId, plan, programmeStartDate, programmeEndDate, pageError }: DashboardTabsProps) {
  return <DashboardTrainingPlan kind={kind} learnerId={learnerId} plan={plan} canOpenActivities showRewards={false} monthlyOnly programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} pageError={pageError} />;
}
