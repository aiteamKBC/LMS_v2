import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
export default function DashboardTrainingTab({ kind, learnerId, plan, programmeStartDate, programmeEndDate, pageError }: DashboardTabsProps) {
  return <DashboardTrainingPlan kind={kind} learnerId={learnerId} plan={plan} canOpenActivities showRewards={false} trainingOnly programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} pageError={pageError} />;
}
