import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, CalendarOff, Clock3, ExternalLink, Target, Users, Video } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { buildCurriculumTimeline, type CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import { learningToday } from '@/pages/learner/my-learning/subjectLearning';
import { dateLabel, ukDate, ukTime } from './overviewSchedule';
import { learnerHeaderPlan } from './learnerHeaderPlan';
import { completedComponentIds, ksbTypeCode, resourceTypeMeta, type JourneyComponent } from '@/utils/learnerJourney';
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { cn } from '@/lib/cn';
import {
  activityActionLabel, activityExpectedTimeLabel, activityHref, activityKsbCodes, activityStatus,
  resolveInitialWeek, weekComponents, weekKey, weekProgress, weekWindow, type ActivityStatus,
} from './weeklyPlanHelpers';

type SessionRow = Extract<CurriculumRow, { kind: 'session' }>;
type ReadingWeekRow = Extract<CurriculumRow, { kind: 'reading-week' }>;

const STATUS_TONE: Record<ActivityStatus, 'positive' | 'info' | 'neutral'> = {
  completed: 'positive', 'in-progress': 'info', 'not-started': 'neutral',
};
const STATUS_LABEL: Record<ActivityStatus, string> = {
  completed: 'Completed', 'in-progress': 'In progress', 'not-started': 'Not started',
};
const WEEK_PAGE_SIZE = 8;
const ACTIVITY_PAGE_SIZE = 8;

export function WeeklyLearningPlan({ kind, learnerId, schedule, scheduleLoading, scheduleError }: {
  kind: LearnerKind; learnerId: string; schedule: TrainingPlanDashboard | null; scheduleLoading: boolean; scheduleError?: string;
}) {
  const { real, loading: detailLoading, loadError: detailError, refresh: refreshDetail } = useLearnerDetailParam(kind, learnerId, true);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const today = learningToday();

  const candidateModules = useMemo(() => (schedule?.modules || []).filter(module => (module.curriculumSlots?.length ?? 0) > 0), [schedule]);
  const plan = useMemo(() => learnerHeaderPlan(candidateModules, real || {}, today), [candidateModules, real, today]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const resolvedModuleId = (selectedModuleId && candidateModules.some(module => module.id === selectedModuleId) ? selectedModuleId : null)
    || plan.modules[0]?.id || candidateModules[0]?.id || null;
  const module = candidateModules.find(item => item.id === resolvedModuleId);

  const weeks = useMemo(() => {
    const sessions = (schedule?.sessions || []).filter(session => session.moduleId === resolvedModuleId);
    return buildCurriculumTimeline(module?.curriculumSlots, sessions);
  }, [module, schedule?.sessions, resolvedModuleId]);
  const [weekPage, setWeekPage] = useState(0);
  const weekPageCount = Math.max(1, Math.ceil(weeks.length / WEEK_PAGE_SIZE));
  const visibleWeekOffset = Math.min(weekPage, weekPageCount - 1) * WEEK_PAGE_SIZE;
  const visibleWeeks = weeks.slice(visibleWeekOffset, visibleWeekOffset + WEEK_PAGE_SIZE);
  useEffect(() => { setWeekPage(0); }, [resolvedModuleId]);
  useEffect(() => { if (weekPage >= weekPageCount) setWeekPage(Math.max(0, weekPageCount - 1)); }, [weekPage, weekPageCount]);

  const [selection, setSelection] = useState<{ moduleId: string; key: string } | null>(null);
  const initialWeek = resolveInitialWeek(weeks, today);
  const selectedWeek = (selection?.moduleId === resolvedModuleId && weeks.find(week => weekKey(week) === selection.key)) || initialWeek;
  const selectedIndex = selectedWeek ? weeks.findIndex(week => weekKey(week) === weekKey(selectedWeek)) : -1;

  const completedIds = useMemo(() => completedComponentIds(real), [real]);
  const isTeachingWeek = selectedWeek?.kind === 'session';
  const components = isTeachingWeek ? weekComponents(real, resolvedModuleId || undefined, (selectedWeek as SessionRow).weekId) : [];
  const progress = weekProgress(components, completedIds);

  // A schedule failure with nothing cached is already surfaced by the
  // dashboard's own retry banner above this component -- a second, redundant
  // error box here would just repeat it. Curriculum slots live only in the
  // training-plan-dashboard payload, so there is no independent source left
  // to fall back to the way the old, decoupled "This week" card could.
  if (!schedule && !scheduleLoading && scheduleError) return null;

  return <section aria-label="Weekly learning plan" className="grid grid-cols-1 gap-3 lg:items-start lg:grid-cols-[260px_minmax(0,1fr)]">
    {!schedule ? <WeeklyLearningPlanSkeleton /> : !candidateModules.length ? <Panel className="lg:col-span-2">
      <EmptyState title="Your weekly plan will appear here" description="Once a module is assigned, its weeks and activities will show up in this space." />
    </Panel> : <>
    <aside className="rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-foreground-900">Weeks</h2>
      </div>
      {candidateModules.length > 1 && <label className="mt-3 block text-xs font-medium text-foreground-500">Module
        <select aria-label="Module" value={resolvedModuleId || ''} onChange={event => { setSelectedModuleId(event.target.value); setSelection(null); }}
          className="mt-1 w-full rounded-lg border border-foreground-200 bg-background-50 px-2.5 py-2 text-sm font-semibold text-foreground-900">
          {candidateModules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>}
      {weeks.length ? <>
      <ol className="mt-3 space-y-1">
        {visibleWeeks.map((week, index) => {
          const absoluteIndex = visibleWeekOffset + index;
          const active = selectedWeek ? weekKey(week) === weekKey(selectedWeek) : false;
          const { start, end } = weekWindow(weeks, absoluteIndex);
          const state: 'past' | 'current' | 'upcoming' = start > today ? 'upcoming' : end !== null && end < today ? 'past' : 'current';
          const isReadingWeek = week.kind === 'reading-week';
          const isCompleted = state === 'past';
          const isCurrent = state === 'current';
          const label = week.kind === 'reading-week' ? 'Reading week' : `Week ${week.sessionNumber}`;
          const subLabel = week.kind === 'reading-week' ? 'Independent study' : week.weekTitle || 'Learning activities';
          const range = `${dateLabel(start)}${end ? ` – ${dateLabel(end)}` : ''}`;
          const stateLabel = state === 'past' ? 'Completed' : state === 'current' ? 'Current week' : 'Upcoming';
          return <li key={weekKey(week)} className="relative pl-8">
            {index < visibleWeeks.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-7 bottom-[-0.75rem] w-px bg-foreground-200" />}
            <span aria-hidden="true" className={cn(
              'absolute left-0 top-4 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-background-50',
              isCompleted ? 'border-emerald-500 bg-emerald-500 text-white'
                : isCurrent ? 'border-foreground-950 bg-foreground-950 text-white'
                  : isReadingWeek ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : active ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-foreground-300 text-transparent',
            )}>
              {isCompleted || isCurrent || active ? <span className="h-1.5 w-1.5 rounded-full bg-white" />
                : isReadingWeek ? <BookOpen size={13} aria-hidden="true" /> : null}
            </span>
            <button type="button" aria-current={active ? 'true' : undefined}
              onClick={() => resolvedModuleId && setSelection({ moduleId: resolvedModuleId, key: weekKey(week) })}
              className={cn('block w-full rounded-lg px-3 py-3 text-left transition',
                isCompleted ? 'bg-emerald-50/70 text-emerald-950 hover:bg-emerald-50'
                  : isCurrent ? 'bg-slate-100 text-foreground-950 shadow-sm'
                    : active ? 'bg-primary-50 text-primary-950 shadow-sm'
                      : isReadingWeek ? 'bg-amber-50/75 hover:bg-amber-50'
                        : 'hover:bg-background-100')}>
              <span className="min-w-0 text-left">
                <span className={cn('block text-sm font-bold',
                  isCompleted ? 'text-emerald-700'
                    : isCurrent ? 'text-foreground-950'
                      : active ? 'text-primary-700'
                        : isReadingWeek ? 'text-amber-800'
                          : 'text-foreground-900',
                )}>{label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-foreground-500">{range}</span>
                <span className="block truncate text-xs leading-5 text-foreground-600">{subLabel}</span>
                <span className="sr-only">{stateLabel}{active ? ', selected' : ''}</span>
              </span>
            </button>
          </li>;
        })}
      </ol>
      <PaginationControls page={weekPage} pageCount={weekPageCount} onPageChange={setWeekPage} label="weeks" className="mt-3" />
      </> : <EmptyState size="sm" title="No weeks scheduled yet" description="This module's weekly schedule isn't available yet." className="mt-3" />}
    </aside>

    <div className="min-w-0 rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm">
      {!selectedWeek ? <Panel><EmptyState title="No weeks scheduled yet" description="This module's weekly schedule isn't available yet." /></Panel> : <>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-foreground-100 pb-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-600">
            {selectedWeek.kind === 'reading-week' ? 'Reading week' : `Week ${selectedWeek.sessionNumber}`}
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight text-foreground-950">
            {selectedWeek.kind === 'reading-week' ? 'Reading week' : selectedWeek.weekTitle || 'This week'}
          </h2>
          {selectedIndex >= 0 ? <p className="mt-1 text-sm font-medium text-foreground-500">
            {(() => { const { start, end } = weekWindow(weeks, selectedIndex); return `${dateLabel(start)}${end ? ` – ${dateLabel(end)}` : ''}`; })()}
          </p> : null}

            </div>

            {isTeachingWeek && <div className="w-full shrink-0 md:w-[230px]">
              <div className="flex items-end justify-between gap-3">
                <span className="text-xs font-bold text-foreground-700">Week progress</span>
                <strong className="text-2xl font-bold tabular-nums text-foreground-900">{progress.percent}%</strong>
              </div>
              <ProgressBar percent={progress.total ? progress.percent : null} tone="bg-primary-600" height="h-2" className="mt-2" />
              <p className="mt-1.5 text-xs font-medium text-foreground-500">{progress.completed} of {progress.total} activities</p>
            </div>}
          </div>

          {isTeachingWeek && <>
            <section aria-labelledby="weekly-outcomes-heading" className="mt-4 flex gap-4 rounded-xl border border-primary-100 bg-primary-50/45 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 ring-1 ring-primary-200/70">
                <Target size={23} aria-hidden="true" />
              </span>
              <div className="min-w-0">
              <h3 id="weekly-outcomes-heading" className="text-sm font-bold text-foreground-900">Learning outcomes for this week</h3>
              {selectedWeek.learningOutcomes?.length ? <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-6 text-foreground-700 marker:text-primary-600">
                {selectedWeek.learningOutcomes.map(outcome => <li key={outcome}>{outcome}</li>)}
              </ul> : <p className="mt-2 text-sm leading-6 text-foreground-500">Learning outcomes for this week have not been published yet.</p>}
              </div>
            </section>
          </>}

          <section aria-labelledby="weekly-session-heading" className="mt-4">
            {selectedWeek.kind === 'reading-week' ? <ReadingWeekPanel week={selectedWeek} />
              : selectedWeek.start ? <LiveSessionSummary week={selectedWeek} now={now} headingId="weekly-session-heading" />
                : <p id="weekly-session-heading" className="text-sm text-foreground-500">No live session is scheduled for this week.</p>}
          </section>
        </div>

        {isTeachingWeek && <section aria-labelledby="weekly-activities-heading" className="mt-5">
          <h3 id="weekly-activities-heading" className="text-sm font-bold text-foreground-900">
            Week activities {components.length > 0 && <span className="font-normal text-foreground-400">({components.length})</span>}
          </h3>
          <div className="mt-3">
            {detailError && !real ? <Panel><EmptyState variant="error" title="Could not load this week's activities" description={detailError}
              action={<button type="button" onClick={refreshDetail} className="rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white">Try again</button>} /></Panel>
              : detailLoading && !real ? <Panel><RowsSkeleton rows={3} avatar={false} /></Panel>
                : <ActivitiesTableModern components={components} completedIds={completedIds} kind={kind} learnerId={learnerId} week={selectedWeek.weekTitle} />}
          </div>
        </section>}
      </>}
    </div>
    </>}
  </section>;
}

function PaginationControls({ page, pageCount, onPageChange, label, className }: {
  page: number; pageCount: number; onPageChange: (page: number) => void; label: string; className?: string;
}) {
  if (pageCount <= 1) return null;
  return <nav aria-label={`${label} pagination`} className={cn('flex items-center justify-between gap-3 text-xs font-semibold text-foreground-500', className)}>
    <button
      type="button"
      onClick={() => onPageChange(Math.max(0, page - 1))}
      disabled={page <= 0}
      className="inline-flex min-h-8 items-center justify-center rounded-lg border border-foreground-200 bg-background-50 px-3 text-foreground-700 disabled:cursor-not-allowed disabled:opacity-45"
    >
      Previous
    </button>
    <span className="whitespace-nowrap">Page {page + 1} of {pageCount}</span>
    <button
      type="button"
      onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
      disabled={page >= pageCount - 1}
      className="inline-flex min-h-8 items-center justify-center rounded-lg border border-foreground-200 bg-background-50 px-3 text-foreground-700 disabled:cursor-not-allowed disabled:opacity-45"
    >
      Next
    </button>
  </nav>;
}

function LiveSessionSummary({ week, now, headingId }: { week: SessionRow; now: number; headingId: string }) {
  const start = week.start as string;
  const startMs = Date.parse(start);
  const end = week.minutes ? new Date(startMs + week.minutes * 60_000) : null;
  const hasJoinUrl = !!week.joinUrl;
  const sessionEnded = Number.isFinite(startMs) && startMs <= now;
  return <div className="flex flex-col gap-4 rounded-xl border border-foreground-100 bg-background-50 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
    <div className="flex min-w-0 gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 ring-1 ring-primary-200/70">
        <Users size={22} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 id={headingId} className="text-sm font-bold text-foreground-900">Scheduled live session</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground-950">{week.title}</p>
          <StatusBadge tone="info" label="Live session" size="sm" dot={false} className="bg-primary-100 text-primary-700" />
        </div>
        <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-foreground-600">
          <div className="inline-flex items-center gap-1.5">
            <CalendarDays size={15} className="text-foreground-400" aria-hidden="true" />
            <dt className="sr-only">Date</dt>
            <dd>{dateLabel(ukDate(start))}</dd>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Clock3 size={15} className="text-foreground-400" aria-hidden="true" />
            <dt className="sr-only">Time</dt>
            <dd>{ukTime(start)}{end ? ` - ${ukTime(end.toISOString())}` : ''}{week.minutes ? ` (${durationLabel(week.minutes)})` : ''}</dd>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Video size={15} className="text-foreground-400" aria-hidden="true" />
            <dt className="sr-only">Delivery</dt>
            <dd>Microsoft Teams</dd>
          </div>
        </dl>
        {!hasJoinUrl ? <p className="mt-3 text-xs text-foreground-500">
          {week.attended === true ? 'You attended this session.' : week.attended === false || sessionEnded ? 'This session has ended.'
            : 'A join link has not been added yet.'}
        </p> : null}
      </div>
    </div>
    {hasJoinUrl ? <a href={week.joinUrl!} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-xs font-bold text-white shadow-sm hover:bg-primary-700 md:min-w-[128px]">
      Join session<ExternalLink size={13} aria-hidden="true" />
    </a> : null}
  </div>;
}

function durationLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} min`;
}

function ReadingWeekPanel({ week }: { week: ReadingWeekRow }) {
  return <div className="rounded-xl border border-foreground-100 bg-background-50 p-4 shadow-sm">
    <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background-100 text-foreground-500"><CalendarOff size={18} aria-hidden="true" /></span><p className="text-sm font-semibold text-foreground-900">No session this week</p></div>
    {week.holidays.length ? <ul className="mt-2 space-y-1 text-xs text-foreground-500">
      {week.holidays.map((holiday, index) => <li key={`${holiday.id || holiday.label}-${index}`}>
        {holiday.label || 'Holiday'} · {dateLabel(holiday.startDate)}{holiday.endDate && holiday.endDate !== holiday.startDate ? ` – ${dateLabel(holiday.endDate)}` : ''}
      </li>)}
    </ul> : <p className="mt-2 text-xs text-foreground-500">This delivery day is closed. Use the week for independent study.</p>}
  </div>;
}

function KsbChips({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="text-foreground-400">—</span>;
  return <div className="flex flex-wrap gap-1">
    {codes.map(code => {
      const type = ksbTypeCode(undefined, code);
      const tone = type === 'K' ? 'border-primary-200 bg-primary-50 text-primary-700'
        : type === 'S' ? 'border-accent-200 bg-accent-50 text-accent-700'
          : type === 'B' ? 'border-secondary-200 bg-secondary-100 text-foreground-800'
            : 'border-foreground-200 bg-background-100 text-foreground-600';
      return <span key={code} className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', tone)}>{code}</span>;
    })}
  </div>;
}

function ActivitiesTableModern({ components, completedIds, kind, learnerId, week }: {
  components: JourneyComponent[]; completedIds: Set<string>; kind: LearnerKind; learnerId: string; week?: string;
}) {
  const componentPageKey = components.map(component => component.componentId || component.title).join('|');
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(components.length / ACTIVITY_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleComponents = components.slice(safePage * ACTIVITY_PAGE_SIZE, safePage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE);
  useEffect(() => { setPage(0); }, [componentPageKey]);
  useEffect(() => { if (page >= pageCount) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);

  if (!components.length) return <Panel><EmptyState size="sm" title="No activities yet" description="Activities will appear here once they are added to this week." /></Panel>;

  return <div className="overflow-hidden rounded-xl border border-foreground-100 bg-background-50 shadow-sm">
    <div className="max-w-full" style={{ overflowX: 'auto' }}>
      <table className="w-full min-w-[720px] text-left text-[12px]">
        <caption className="sr-only">This week's learning activities</caption>
        <thead className="bg-background-100/90">
          <tr>
            {['Type', 'Title', 'Expected time', 'KSB mapping', 'Status', 'Action'].map(label => (
              <th key={label} scope="col" className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.06em] text-foreground-500">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleComponents.map(component => {
            const status = activityStatus(component, completedIds);
            const href = activityHref(component, week, kind, learnerId, status === 'completed');
            const typeLabel = activityTypeLabel(component);
            const meta = resourceTypeMeta(component.type || typeLabel);
            return <tr key={component.componentId || component.title} className="border-t border-foreground-100">
              <td className="w-16 px-3 py-2.5 align-middle">
                <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg', meta.bg, meta.color)}>
                  <AppIcon className={meta.icon} size={16} aria-label={typeLabel} />
                </span>
              </td>
              <td className="max-w-[260px] px-3 py-2.5 align-middle">
                <p className="text-[13px] font-semibold leading-4 text-foreground-900">{component.title}</p>
              </td>
              <td className="w-28 px-3 py-2.5 align-middle text-xs font-semibold tabular-nums text-foreground-700">
                <span className="inline-flex items-center gap-1.5"><Clock3 size={13} className="text-foreground-400" aria-hidden="true" />{activityExpectedTimeLabel(component)}</span>
              </td>
              <td className="w-28 px-3 py-2.5 align-middle"><KsbChips codes={activityKsbCodes(component)} /></td>
              <td className="w-28 px-3 py-2.5 align-middle"><StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} size="sm" showIcon={status === 'completed'} className="text-[11px]" /></td>
              <td className="w-28 px-3 py-2.5 text-right align-middle">
                {href ? <Link to={href} className={cn(
                  'inline-flex min-h-8 min-w-[86px] items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-[11px] font-bold leading-none transition',
                  status === 'in-progress' ? 'bg-primary-600 text-white shadow-sm hover:bg-primary-700' : 'border border-primary-200 bg-background-50 text-primary-700 hover:border-primary-300 hover:bg-primary-50',
                )}>{activityActionLabel(status)}</Link> : <span className="text-xs text-foreground-400">Not available</span>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <PaginationControls page={safePage} pageCount={pageCount} onPageChange={setPage} label="activities" className="border-t border-foreground-100 px-3 py-3" />
  </div>;
}

function activityTypeLabel(component: JourneyComponent): string {
  return (component.type || 'activity').replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function WeeklyLearningPlanSkeleton() {
  return <section aria-busy="true" aria-label="Loading your weekly learning plan" className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
    <Panel>
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground-400"><BookOpen size={16} aria-hidden="true" />Weeks</div>
      <RowsSkeleton rows={4} avatar={false} />
    </Panel>
    <Panel><RowsSkeleton rows={4} /></Panel>
  </section>;
}
