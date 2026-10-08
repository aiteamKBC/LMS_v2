import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useLearningPlanRead, type LearningPlanProjection, type JourneyModuleRow, type JourneyModuleDetail, type JourneyWeekDetail, type JourneyWeekRow } from '@/features/coach/case-file/hooks/useCaseFileLearningPlan';
import { CoachComponentRow } from '../components/OverviewTab';
import { formatHours } from '../data';
import { CaseFileTimeline } from './CaseFileTimeline';
import styles from '../learnerCaseFile.module.css';

export function CaseFileLearningPlanTab() {
  const response = useLearningPlanRead<LearningPlanProjection>('learning-plan');
  const [selected, setSelected] = useState('');
  if (response.error) return <LoadError error={response.error} retry={response.refresh} />;
  if (!response.data) return <RowsSkeleton rows={4} avatar={false} />;
  const { timeline, journey } = response.data;
  return <div className="space-y-5">
    <CaseFileTimeline timeline={timeline} selectedId={selected} onSelect={setSelected} />
    <section className={styles.panel} aria-label="Programme Journey">
      <div className={styles.panelHeader}><div><h2 className={styles.panelTitle}>Programme Journey</h2>
        <p className={styles.panelSubtitle}>Read-only module, week, and component view for coach context.</p></div>
        <div className="flex flex-wrap gap-1.5">{Object.entries({ Modules: journey.summary.modules, Weeks: journey.summary.weeks,
          Components: journey.summary.components, Completed: journey.summary.completed, 'In progress': journey.summary.inProgress,
          'Not started': journey.summary.notStarted, ...(journey.summary.unavailable ? { Unavailable: journey.summary.unavailable } : {}) }).map(([label, value]) => <Pill key={label} label={label} value={String(value)} />)}</div></div>
      <div className="max-h-[680px] space-y-3 overflow-y-auto bg-background-100/20 p-3 md:p-4">
        {journey.modules.length ? journey.modules.map((module, index) => <ModuleRow key={module.id} module={module} index={index}
          selected={selected === module.id} onSelect={() => setSelected(selected === module.id ? '' : module.id)} />) : <p>No structured plan has been saved for this learner yet.</p>}
      </div>
    </section>
  </div>;
}

function Pill({ label, value }: { label: string; value: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-[10px] font-semibold text-foreground-700"><span>{label}</span><strong>{value}</strong></span>;
}

function ModuleRow({ module, index, selected, onSelect }: { module: JourneyModuleRow; index: number; selected: boolean; onSelect: () => void }) {
  const detail = useLearningPlanRead<JourneyModuleDetail>('learning-plan-module', { moduleId: module.id }, selected);
  return <article className="overflow-hidden rounded-xl border border-background-200 bg-white">
    <button type="button" aria-expanded={selected} onClick={onSelect} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-background-100/50 md:px-5">
      <AppIcon className="ri-book-2-line text-primary-600" /><span className="min-w-0 flex-1"><span className="block text-[12px] font-bold uppercase tracking-[0.16em] text-primary-600">Module {String(index + 1).padStart(2, '0')}</span>
        <span className="block truncate text-sm font-bold text-foreground-950">{module.title}</span>
        <span className="block text-[12px] text-foreground-400">{module.weekCount} {module.weekCount === 1 ? 'week' : 'weeks'} · {module.componentCount} {module.componentCount === 1 ? 'component' : 'components'} · {module.progressPercent}%</span></span>
      <StateBadge status={module.status} />{module.otjh > 0 && <Pill label="OTJH" value={formatHours(module.otjh)} />}
      <Pill label="Completed" value={`${module.completedCount} / ${module.componentCount}`} /><Pill label="Items" value={String(module.componentCount)} />
      <AppIcon className={`ri-arrow-down-s-line ${selected ? 'rotate-180' : ''}`} />
    </button>
    {selected && <div className="space-y-2 border-t border-background-300 p-4 pl-10">
      {detail.error ? <LoadError error={detail.error} retry={detail.refresh} /> : !detail.data ? <RowsSkeleton rows={3} avatar={false} /> : detail.data.weeks.length ?
        detail.data.weeks.map(week => <WeekRow key={week.id} moduleId={module.id} week={week} />) : <p>No weeks added yet.</p>}
    </div>}
  </article>;
}

function WeekRow({ moduleId, week }: { moduleId: string; week: JourneyWeekRow }) {
  const [open, setOpen] = useState(false);
  const detail = useLearningPlanRead<JourneyWeekDetail>('learning-plan-week', { moduleId, weekId: week.id }, open);
  return <div className="overflow-hidden rounded-xl border border-background-300 bg-background-50">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-background-100/55">
      <AppIcon className="ri-calendar-line" /><span className="flex-1"><span className="block text-sm font-bold">{week.title}</span>
        <span className="text-[12px] text-foreground-400">{week.completedCount} / {week.componentCount} completed</span></span>
      {week.otjh > 0 && <span>{formatHours(week.otjh)}</span>}<AppIcon className={`ri-arrow-down-s-line ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="divide-y divide-background-300 border-t border-background-300">
      {detail.error ? <LoadError error={detail.error} retry={detail.refresh} /> : !detail.data ? <RowsSkeleton rows={2} avatar={false} /> : detail.data.components.length ?
        detail.data.components.map(component => <CoachComponentRow key={component.componentId} component={component} state={component} />) : <p className="p-4">No components in this week.</p>}
    </div>}
  </div>;
}

function StateBadge({ status }: { status: JourneyModuleRow['status'] }) {
  const label = { completed: '✓ Completed', 'in-progress': '• In progress', 'not-started': '○ Not started', unavailable: 'Unavailable' }[status];
  return <StatusBadge tone={status === 'completed' ? 'positive' : status === 'not-started' ? 'neutral' : 'caution'} label={label} size="sm" />;
}

function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error} <button type="button" onClick={retry}>Retry Learning Plan</button></div>;
}
