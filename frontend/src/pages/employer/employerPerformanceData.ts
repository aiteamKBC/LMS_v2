import type { OverviewModule } from '@/api/dashboardTabs';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { overviewModulesForDisplay } from '@/pages/workspace/learner/overviewFacts';
import { learnerKey, reviewState, type DashboardAttendance, type DashboardReviews } from './employerDashboardData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const ratio = (done: unknown, total: unknown) => finite(done) && finite(total) && total > 0 ? Math.min(100, done / total * 100) : null;
export const mean = (values: (number | null | undefined)[]) => {
  const available = values.filter(finite);
  return { value: available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null, available: available.length };
};

function assignmentRate(modules: OverviewModule[]) {
  // Missing fields remain unavailable, including older server responses.
  if (!modules.length || modules.some(module => !module.assignments)) return null;
  return ratio(modules.reduce((sum, module) => sum + module.assignments!.submitted, 0),
    modules.reduce((sum, module) => sum + module.assignments!.total, 0));
}

export function employerPerformance(learners: EmployerLearnerCard[], records: EmployerLearningRecords,
  attendance: DashboardAttendance, reviews: DashboardReviews) {
  const rows = learners.map(learner => {
    const key = learnerKey(learner);
    const payload = records[key]?.data;
    const register = attendance[key]?.data;
    return { learner, attendance: register ? ratio(register.present, register.sessions) : null,
      assignments: assignmentRate(payload?.modules || []), hours: finite(learner.otjhProgress?.actual) ? learner.otjhProgress.actual : null,
      otj: ratio(learner.otjhProgress?.actual, learner.otjhProgress?.planned),
      ksb: ratio(payload?.metrics?.ksb?.completed, payload?.metrics?.ksb?.total),
      reviews: payload?.reviews?.percent ?? null };
  });
  const rates = [mean(rows.map(row => row.attendance)), mean(rows.map(row => row.assignments)),
    mean(rows.map(row => row.otj)), mean(rows.map(row => row.ksb)), mean(rows.map(row => row.reviews))];
  const events = learners.flatMap(learner => {
    const resource = reviews[learnerKey(learner)];
    return resource?.status === 'ready' ? resource.data || [] : [];
  });
  return { rows, rates, hours: mean(rows.map(row => row.hours)),
    reviewCount: events.length, completedReviews: events.filter(event => reviewState(event) === 'completed').length,
    reviewsAvailable: learners.filter(learner => reviews[learnerKey(learner)]?.status === 'ready').length };
}

export function modulePerformance(learners: EmployerLearnerCard[], records: EmployerLearningRecords, selected: string) {
  const rows = learners.flatMap(learner => {
    const modules = overviewModulesForDisplay(records[learnerKey(learner)]?.data?.modules || [])
      .filter(module => !selected || module.id === selected);
    if (!modules.length) return [];
    const sum = (get: (module: OverviewModule) => number | null | undefined) => {
      const values = modules.map(get);
      return values.every(finite) ? values.reduce<number>((total, value) => total + value!, 0) : null;
    };
    return [{ learner, values: [
      ratio(sum(module => module.hours.actual), sum(module => module.hours.planned)),
      ratio(sum(module => module.ksb?.completed), sum(module => module.ksb?.total)),
      assignmentRate(modules),
      ratio(sum(module => module.attendance?.attended), sum(module => module.attendance?.total)),
    ] }];
  });
  return { rows, measures: ['Off-the-job hours', 'KSBs', 'Assignment submission', 'Attendance'].map((label, index) => ({
    label, ...mean(rows.map(row => row.values[index])),
  })) };
}
