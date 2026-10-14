import { useMemo, useState } from 'react';
import { useCaseFileOverview } from '@/features/coach/case-file/hooks/useCaseFileOverview';
import { useCaseFileOverviewModule } from '@/features/coach/case-file/hooks/useCaseFileOverviewModule';
import { ProgressCharts, type ProgrammeProgressSnapshot } from '@/pages/learner/training-plan-timeline/ProgressCharts';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { buildPlanModules } from '@/pages/learner/training-plan-timeline/model';
import { buildUnifiedLearningSummary } from '@/pages/learner/my-learning/learningSummary';
import layout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

const emptyPlan: TrainingPlanDashboard = { months: {}, contractStatus: 'not-available', actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: '', bookingUrl: '' }, generatedAt: '' };

export function CaseFileOverviewTab(_props: { snapshot: ProgrammeProgressSnapshot; hasActivitySnapshot?: boolean }) {
  const state = useCaseFileOverview();
  const [selectedId, setSelectedId] = useState('');
  const overview = state.data?.moduleOverview;
  const index = state.data?.moduleIndex;
  const plan = useMemo<TrainingPlanDashboard>(() => {
    const catalogue = index || overview;
    return catalogue ? {
      ...emptyPlan, ...catalogue,
      modules: catalogue.modules.map(module => ({ ...module, description: '', tutor_name: '', coach_name: '' })),
      sessions: index ? [] : (overview?.sessions || []).map(session => ({ ...session, joinUrl: null })),
    } : emptyPlan;
  }, [index, overview]);
  const modules = useMemo(() => {
    if (index) return buildPlanModules(index.subjects, plan);
    const learning = overview?.learning;
    if (!learning) return [];
    const summary = buildUnifiedLearningSummary(learning.activity, learning.detail, learning.metadata);
    return buildPlanModules(summary.subjects, plan);
  }, [index, overview, plan]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const selected = modules.find(module => module.id === selectedId)
    || modules.find(module => module.start && module.start <= today && module.end >= today) || modules[0];
  const measures = useCaseFileOverviewModule(index ? selected?.id : undefined);
  const selectedPlan = useMemo(() => measures.data ? { ...plan, ...measures.data } : plan, [plan, measures.data]);
  const measured = useMemo(() => index && measures.data
    ? buildPlanModules(index.subjects, selectedPlan).find(module => module.id === selected?.id) : selected,
  [index, measures.data, selectedPlan, selected]);
  const moduleStatus = index && selected ? measures.error
    ? <div role="alert">{measures.error}<button type="button" onClick={measures.retry}>Retry module</button></div>
    : !measures.data ? <div role="status" aria-label="Loading module progress"><RowsSkeleton rows={3} /></div> : undefined
    : undefined;
  if (state.error) return <div role="alert">{state.error}<button type="button" onClick={state.retry}>Retry overview</button></div>;
  if (!state.data) return <div role="status" aria-label="Loading overview"><RowsSkeleton rows={5} /></div>;
  if (!index && !overview?.learning) return <div role="alert">Module progress could not be loaded.<button type="button" onClick={state.retry}>Retry overview</button></div>;
  return <div className={layout.root}><ProgressCharts modules={modules} selected={measured} data={selectedPlan} moduleStatus={moduleStatus} onModuleSelect={module => setSelectedId(module.id)} showOtjChart={false}
    programmeRows={state.data.programmeProgress.map(row => ({ id: row.id, title: row.title, value: row.percent }))} /></div>;
}
