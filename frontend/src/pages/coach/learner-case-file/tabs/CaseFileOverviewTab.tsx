import { useMemo, useState } from 'react';
import { useCaseFileOverview } from '@/features/coach/case-file/hooks/useCaseFileOverview';
import { ProgressCharts, type ProgrammeProgressSnapshot } from '@/pages/learner/training-plan-timeline/ProgressCharts';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { buildPlanModules } from '@/pages/learner/training-plan-timeline/model';
import { dashboardPlanSubjects } from '@/pages/workspace/learner/dashboardPlan';
import layout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

const emptyPlan: TrainingPlanDashboard = { months: {}, contractStatus: 'not-available', actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: '', bookingUrl: '' }, generatedAt: '' };

export function CaseFileOverviewTab(_props: { snapshot: ProgrammeProgressSnapshot; hasActivitySnapshot?: boolean }) {
  const state = useCaseFileOverview();
  const [selectedId, setSelectedId] = useState('');
  const overview = state.data?.moduleOverview;
  const plan = useMemo<TrainingPlanDashboard>(() => overview ? {
    ...emptyPlan, ...overview,
    modules: overview.modules.map(module => ({ ...module, description: '', tutor_name: '', coach_name: '' })),
    sessions: overview.sessions.map(session => ({ ...session, joinUrl: null })),
  } : emptyPlan, [overview]);
  const modules = useMemo(() => buildPlanModules(dashboardPlanSubjects(overview?.subjects || [], plan), plan), [overview, plan]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const selected = modules.find(module => module.id === selectedId)
    || modules.find(module => module.start && module.start <= today && module.end >= today) || modules[0];
  if (state.error) return <div role="alert">{state.error}<button type="button" onClick={state.retry}>Retry overview</button></div>;
  if (!state.data) return <div role="status" aria-label="Loading overview"><RowsSkeleton rows={5} /></div>;
  if (!overview) return <div role="alert">Module progress could not be loaded.<button type="button" onClick={state.retry}>Retry overview</button></div>;
  return <div className={layout.root}><ProgressCharts modules={modules} selected={selected} data={plan} onModuleSelect={module => setSelectedId(module.id)} showOtjChart={false}
    programmeRows={state.data.programmeProgress.map(row => ({ id: row.id, title: row.title, value: row.percent }))} /></div>;
}
