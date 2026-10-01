import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
export default function DashboardMonthlyTab({ kind, learnerId, plan, programmeStartDate, programmeEndDate }: DashboardTabsProps) {
  return <DashboardTrainingPlan kind={kind} learnerId={learnerId} plan={plan} canOpenActivities showRewards={false} monthlyOnly programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} />;
}
