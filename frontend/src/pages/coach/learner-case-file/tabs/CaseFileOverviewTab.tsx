import { useCaseFileOverview } from '@/features/coach/case-file/hooks/useCaseFileOverview';
import { ProgressCharts, type ProgrammeProgressSnapshot } from '@/pages/learner/training-plan-timeline/ProgressCharts';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { RowsSkeleton } from '@/components/feature/Skeletons';

const emptyPlan: TrainingPlanDashboard = { months: {}, contractStatus: 'not-available', actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: '', bookingUrl: '' }, generatedAt: '' };

export function CaseFileOverviewTab(_props: { snapshot: ProgrammeProgressSnapshot; hasActivitySnapshot?: boolean }) {
  const state = useCaseFileOverview();
  if (state.error) return <div role="alert">{state.error}<button type="button" onClick={state.retry}>Retry overview</button></div>;
  if (!state.data) return <div role="status" aria-label="Loading overview"><RowsSkeleton rows={5} /></div>;
  const progress = state.data.wholeProgrammeProgress;
  return <ProgressCharts modules={[]} data={emptyPlan} onModuleSelect={() => {}} showOtjChart={false}
    programmeRows={state.data.programmeProgress.map(row => ({ id: row.id, title: row.title, value: row.percent }))} programmeSnapshot={{
      overall: progress.overall.percent, activitiesCompleted: progress.overall.completed,
      activitiesTotal: progress.overall.total, activitiesPercent: progress.overall.percent,
      otjhActual: progress.otjh.actual, otjhTarget: progress.otjh.targetToDate, otjhPercent: progress.otjh.percent,
      ksb: progress.ksb.percent, ksbAvailable: Boolean(progress.ksb.total),
      attendancePresent: progress.attendance.present, attendanceTotal: progress.attendance.sessions, attendancePercent: progress.attendance.percent,
    }} />;
}
