import type { DashboardTabsProps } from '../DashboardTabs';
import { WeeklyLearningPlan } from '../WeeklyLearningPlan';
export default function DashboardWeeklyTab({ kind, learnerId, plan }: DashboardTabsProps) {
  return <WeeklyLearningPlan kind={kind} learnerId={learnerId} schedule={plan.schedule.data} scheduleLoading={plan.schedule.loading} scheduleError={plan.schedule.error || undefined} />;
}
