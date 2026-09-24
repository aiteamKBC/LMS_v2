import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Clock3, ExternalLink, Search, Users, Video } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { buildCurriculumTimeline, type CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import { learningToday } from '@/pages/learner/my-learning/subjectLearning';
import { dateLabel, ukDate, ukTime } from './overviewSchedule';
import { learnerHeaderPlan } from './learnerHeaderPlan';
import { completedComponentIds, ksbTypeCode, resourceTypeMeta, type JourneyComponent } from '@/utils/learnerJourney';
import { AppIcon } from '@/components/feature/AppIcon';
import { HolidayNoteHint } from '@/components/feature/HolidayNoteHint';
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
import planLayout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

type SessionRow = Extract<CurriculumRow, { kind: 'session' }>;
type ReadingWeekRow = Extract<CurriculumRow, { kind: 'reading-week' }>;

const STATUS_TONE: Record<ActivityStatus, 'positive' | 'info' | 'neutral'> = {
  completed: 'positive', 'in-progress': 'info', 'not-started': 'neutral',
};
const STATUS_LABEL: Record<ActivityStatus, string> = {
  completed: 'Completed', 'in-progress': 'In progress', 'not-started': 'Not started',
};
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
  const [selection, setSelection] = useState<{ moduleId: string; key: string } | null>(null);
  const initialWeek = resolveInitialWeek(weeks, today);
  const selectedWeek = (selection?.moduleId === resolvedModuleId && weeks.find(week => weekKey(week) === selection.key)) || initialWeek;
  const selectedIndex = selectedWeek ? weeks.findIndex(week => weekKey(week) === weekKey(selectedWeek)) : -1;

  const completedIds = useMemo(() => completedComponentIds(real), [real]);
  const isTeachingWeek = selectedWeek?.kind === 'session';
  const components = isTeachingWeek ? weekComponents(real, resolvedModuleId || undefined, (selectedWeek as SessionRow).weekId, selectedWeek?.slotNumber) : [];
  const progress = weekProgress(components, completedIds);

  // A schedule failure with nothing cached is already surfaced by the
  // dashboard's own retry banner above this component -- a second, redundant
  // error box here would just repeat it. Curriculum slots live only in the
  // training-plan-dashboard payload, so there is no independent source left
  // to fall back to the way the old, decoupled "This week" card could.
  if (!schedule && !scheduleLoading && scheduleError) return null;

  return <section aria-label="Weekly learning plan" className={cn(planLayout.weeklyPlan, 'grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]')}>
    {!schedule ? <WeeklyLearningPlanSkeleton /> : !candidateModules.length ? <Panel className="lg:col-span-2">
      <EmptyState title="Your weekly plan will appear here" description="Once a module is assigned, its weeks and activities will show up in this space." />
    </Panel> : <>
    <aside className={cn(planLayout.weekRail, 'rounded-2xl border border-foreground-100 bg-background-50 p-3 shadow-sm')}>
      <div className="flex items-center justify-between gap-2 border-l-4 border-primary-600 pl-2">
        <h2 className="text-base font-extrabold text-foreground-950">Weeks</h2>
      </div>
      {candidateModules.length > 1 && <label className="mt-2.5 block text-xs font-medium text-foreground-500">Module
        <select aria-label="Module" value={resolvedModuleId || ''} onChange={event => { setSelectedModuleId(event.target.value); setSelection(null); }}
          className="mt-1 w-full rounded-lg border border-foreground-200 bg-background-50 px-2.5 py-1.5 text-xs font-semibold text-foreground-900">
          {candidateModules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>}
      {weeks.length ? <>
      <ol className={cn(planLayout.weekList, 'mt-2.5 space-y-1')}>
        {weeks.map((week, index) => {
          const active = selectedWeek ? weekKey(week) === weekKey(selectedWeek) : false;
          const { start, end } = weekWindow(weeks, index);
          const state: 'past' | 'current' | 'upcoming' = start > today ? 'upcoming' : end !== null && end < today ? 'past' : 'current';
          const isReadingWeek = week.kind === 'reading-week';
          const isCompleted = state === 'past';
          const isCurrent = state === 'current';
          const weekActivityProgress = week.kind === 'session'
            ? weekProgress(weekComponents(real, resolvedModuleId || undefined, week.weekId, week.slotNumber), completedIds)
            : null;
          const label = week.kind === 'reading-week' ? 'Reading week' : week.weekTitle || `Week ${week.sessionNumber}`;
          const subLabel = week.kind === 'reading-week' ? 'Independent study' : '';
          const range = `${dateLabel(start)}${end ? ` – ${dateLabel(end)}` : ''}`;
          const stateLabel = state === 'past' ? 'Completed' : state === 'current' ? 'Current week' : 'Upcoming';
          return <li key={weekKey(week)} className="relative pl-9">
            {index < weeks.length - 1 && <span aria-hidden="true" className="absolute left-[13px] top-9 bottom-[-0.25rem] w-px bg-foreground-200" />}
            {weekActivityProgress?.total ? <span role="progressbar" aria-label={`${label} activity progress`}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={weekActivityProgress.percent}
              aria-valuetext={`${weekActivityProgress.completed} of ${weekActivityProgress.total} activities complete`}
              title={`${weekActivityProgress.completed} of ${weekActivityProgress.total} activities complete`}
              className={cn('absolute left-0 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background-50',
                weekActivityProgress.percent === 100 ? 'text-emerald-600' : 'text-primary-600')}>
              <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90" aria-hidden="true">
                <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
                <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="3"
                  strokeDasharray={`${weekActivityProgress.percent} 100`} pathLength="100" strokeLinecap="round" />
              </svg>
            </span> : <span aria-hidden="true" className={cn('absolute left-0 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-background-50',
              isReadingWeek ? 'border-amber-300 text-amber-700' : 'border-foreground-300')}>
              {isReadingWeek && <BookOpen size={13} />}
            </span>}
            <button type="button" aria-current={active ? 'true' : undefined}
              onClick={() => resolvedModuleId && setSelection({ moduleId: resolvedModuleId, key: weekKey(week) })}
              className={cn('block w-full rounded-lg px-2.5 py-2 text-left transition',
                isCompleted ? 'bg-emerald-50/70 text-emerald-950 hover:bg-emerald-50'
                  : isCurrent ? 'bg-slate-100 text-foreground-950 shadow-sm'
                    : active ? 'bg-primary-50 text-primary-950 shadow-sm'
                      : isReadingWeek ? 'bg-amber-50/75 hover:bg-amber-50'
                        : 'hover:bg-background-100')}>
              <span className="min-w-0 text-left">
                <span className={cn('block truncate text-[13px] font-bold leading-5',
                  isCompleted ? 'text-emerald-700'
                    : isCurrent ? 'text-foreground-950'
                      : active ? 'text-primary-700'
                        : isReadingWeek ? 'text-amber-800'
                          : 'text-foreground-900',
                )}>{label}</span>
                <span className="block text-[11px] leading-4 text-foreground-500">{range}</span>
                {subLabel && <span className="block truncate text-[11px] leading-4 text-foreground-600">{subLabel}</span>}
                <span className="sr-only">{stateLabel}{active ? ', selected' : ''}</span>
              </span>
            </button>
            {/* Outside the row's button: the curriculum team's hint is there to
                be read, not to become part of the label that selects the week. */}
            {week.kind === 'session' && <HolidayNoteHint note={week.holidayNote} className="mt-1.5" />}
          </li>;
        })}
      </ol>
      </> : <EmptyState size="sm" title="No weeks scheduled yet" description="This module's weekly schedule isn't available yet." className="mt-3" />}
    </aside>

    <div className={cn(planLayout.weekDetail, 'min-w-0 rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm')}>
      {!selectedWeek ? <Panel><EmptyState title="No weeks scheduled yet" description="This module's weekly schedule isn't available yet." /></Panel> : <>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-foreground-100 pb-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 border-l-4 border-primary-600 pl-3">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary-700">
            {selectedWeek.kind === 'reading-week' ? 'Reading week' : `Week ${selectedWeek.sessionNumber}`}
          </p>
          <h2 className="mt-1 text-2xl font-extrabold leading-tight text-foreground-950">
            {selectedWeek.kind === 'reading-week' ? 'Reading week' : selectedWeek.weekTitle || 'This week'}
          </h2>
          {selectedIndex >= 0 ? <p className="mt-1 text-sm font-medium text-foreground-500">
            {(() => { const { start, end } = weekWindow(weeks, selectedIndex); return `${dateLabel(start)}${end ? ` – ${dateLabel(end)}` : ''}`; })()}
          </p> : null}
          {selectedWeek.kind === 'session' && <HolidayNoteHint note={selectedWeek.holidayNote} className="mt-2.5 text-xs" />}

            </div>

            {isTeachingWeek && <div className="w-full shrink-0 rounded-xl border border-foreground-100 bg-background-50 p-4 shadow-sm md:w-[300px]">
              <div className="flex items-end justify-between gap-3">
                <span className="text-xs font-bold text-foreground-700">Week progress</span>
                <strong className="text-2xl font-bold tabular-nums text-foreground-900">{progress.percent}%</strong>
              </div>
              <ProgressBar percent={progress.total ? progress.percent : null} tone="bg-primary-600" height="h-2" className="mt-2" />
              <p className="mt-1.5 text-xs font-medium text-foreground-500">{progress.completed} of {progress.total} activities</p>
            </div>}
          </div>

          {isTeachingWeek && <section aria-labelledby="weekly-session-heading" className="mt-5">
            {selectedWeek.start ? <LiveSessionSummary week={selectedWeek} now={now} headingId="weekly-session-heading" />
              : <p id="weekly-session-heading" className="flex min-h-[136px] items-center rounded-xl border border-foreground-100 bg-background-50 p-5 text-sm text-foreground-500">No live session is scheduled for this week.</p>}
          </section>
          }

          {!isTeachingWeek && <section aria-labelledby="weekly-session-heading" className="mt-5">
            <ReadingWeekPanel week={selectedWeek as ReadingWeekRow} />
          </section>}
        </div>

        {isTeachingWeek && <section aria-labelledby="weekly-activities-heading" className="mt-5 overflow-hidden rounded-xl border border-foreground-100 bg-background-50 shadow-sm">
          <div>
            {detailError && !real ? <Panel><EmptyState variant="error" title="Could not load this week's activities" description={detailError}
              action={<button type="button" onClick={refreshDetail} className="rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white">Try again</button>} /></Panel>
              : detailLoading && !real ? <><ActivitiesHeading count={components.length} /><Panel><RowsSkeleton rows={3} avatar={false} /></Panel></>
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
  return <nav aria-label={`${label} pagination`} className={cn('flex items-center justify-between gap-2 text-[10px] font-semibold text-foreground-500', className)}>
    <button
      type="button"
      onClick={() => onPageChange(Math.max(0, page - 1))}
      disabled={page <= 0}
      aria-label={`Previous ${label} page`}
      title={`Previous ${label} page`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-foreground-200 bg-background-50 text-foreground-700 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <ChevronLeft size={15} aria-hidden="true" />
    </button>
    <span className="whitespace-nowrap">Page {page + 1} of {pageCount}</span>
    <button
      type="button"
      onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
      disabled={page >= pageCount - 1}
      aria-label={`Next ${label} page`}
      title={`Next ${label} page`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-foreground-200 bg-background-50 text-foreground-700 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  </nav>;
}

function LiveSessionSummary({ week, now, headingId }: { week: SessionRow; now: number; headingId: string }) {
  const start = week.start as string;
  const startMs = Date.parse(start);
  const end = week.minutes ? new Date(startMs + week.minutes * 60_000) : null;
  const hasJoinUrl = !!week.joinUrl;
  const sessionEnded = Number.isFinite(startMs) && startMs <= now;
  return <div className={cn('flex min-h-[136px] flex-col gap-4 rounded-xl border p-5 md:flex-row md:items-center md:justify-between', planLayout.secondaryLiveCard)}>
    <div className="flex min-w-0 gap-4">
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1', planLayout.secondaryLiveIcon)}>
        <Users size={22} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 id={headingId} className="text-sm font-bold text-foreground-900">Scheduled live session</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground-950">{week.title}</p>
          <StatusBadge tone="positive" label="Live session" size="sm" dot={false} className={planLayout.secondaryLiveBadge} />
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
      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-800 md:min-w-[128px]">
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
  if (!codes.length) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-background-100 px-2 py-1 text-[10px] font-medium text-foreground-400">
        No KSB mapped
      </span>
    );
  }
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

function ActivitiesHeading({ count, controls }: { count: number; controls?: ReactNode }) {
  return <div className="flex flex-col gap-3 border-b border-foreground-100 px-4 py-3.5 md:flex-row md:items-center md:justify-between">
    <h3 id="weekly-activities-heading" className="text-base font-bold text-foreground-950">
      Week activities <span className="font-normal text-foreground-400">({count})</span>
    </h3>
    {controls}
  </div>;
}

function ActivitiesTableModern({ components, completedIds, kind, learnerId, week }: {
  components: JourneyComponent[]; completedIds: Set<string>; kind: LearnerKind; learnerId: string; week?: string;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ActivityStatus>('all');
  const typeOptions = useMemo(() => Array.from(new Set(components.map(activityTypeLabel))).sort(), [components]);
  const filteredComponents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return components.filter(component => {
      const status = activityStatus(component, completedIds);
      const type = activityTypeLabel(component);
      const matchesQuery = !normalizedQuery || `${type} ${component.title}`.toLowerCase().includes(normalizedQuery);
      return matchesQuery && (typeFilter === 'all' || type === typeFilter) && (statusFilter === 'all' || status === statusFilter);
    });
  }, [components, completedIds, query, statusFilter, typeFilter]);
  const componentPageKey = components.map(component => component.componentId || component.title).join('|');
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(filteredComponents.length / ACTIVITY_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleComponents = filteredComponents.slice(safePage * ACTIVITY_PAGE_SIZE, safePage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE);
  useEffect(() => { setPage(0); }, [componentPageKey]);
  useEffect(() => { setPage(0); }, [query, typeFilter, statusFilter]);
  useEffect(() => { if (page >= pageCount) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);

  if (!components.length) return <Panel><EmptyState size="sm" title="No activities yet" description="Activities will appear here once they are added to this week." /></Panel>;

  const controls = <div className="flex flex-wrap items-center gap-2">
    <label className="relative min-w-[180px] flex-1 md:flex-none">
      <span className="sr-only">Search activities</span>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" aria-hidden="true" />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search activities..."
        className="h-9 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-3 text-xs text-foreground-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 md:w-[210px]" />
    </label>
    <select aria-label="Filter activities by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}
      className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-semibold text-foreground-700 outline-none focus:border-primary-400">
      <option value="all">All types</option>
      {typeOptions.map(type => <option key={type} value={type}>{type}</option>)}
    </select>
    <select aria-label="Filter activities by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | ActivityStatus)}
      className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-semibold text-foreground-700 outline-none focus:border-primary-400">
      <option value="all">All status</option>
      <option value="not-started">Not started</option>
      <option value="in-progress">In progress</option>
      <option value="completed">Completed</option>
    </select>
  </div>;

  return <div className="overflow-hidden bg-background-50">
    <ActivitiesHeading count={components.length} controls={controls} />
    {!filteredComponents.length ? <EmptyState size="sm" title="No matching activities" description="Try changing your search or filters." className="m-4" /> : <>
    <div className="max-w-full" style={{ overflowX: 'auto' }}>
      <table className="w-full min-w-[620px] table-fixed text-left text-[10px]">
        <caption className="sr-only">This week's learning activities</caption>
        <colgroup><col className="w-9" /><col className="w-24" /><col /><col className="w-24" /><col className="w-24" /><col className="w-24" /><col className="w-24" /></colgroup>
        <thead className="bg-background-100/90">
          <tr>
            {['#', 'Type', 'Title', 'Expected time', 'KSB mapping', 'Status', 'Action'].map(label => (
              <th key={label} scope="col" className={cn(
                'px-2 py-2 text-left text-[9px] font-bold uppercase tracking-[0.05em] text-foreground-500',
                ['Expected time', 'KSB mapping', 'Status', 'Action'].includes(label) && 'text-center',
              )}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleComponents.map((component, index) => {
            const status = activityStatus(component, completedIds);
            const href = activityHref(component, week, kind, learnerId, status === 'completed');
            const typeLabel = activityTypeLabel(component);
            const meta = resourceTypeMeta(component.type || typeLabel);
            return <tr key={component.componentId || component.title} className="border-t border-foreground-100 transition-colors hover:bg-primary-50/30">
              <td className="px-2 py-2 text-center align-middle font-semibold tabular-nums text-foreground-500">{safePage * ACTIVITY_PAGE_SIZE + index + 1}</td>
              <td className="px-2 py-2 align-middle">
                <div className="flex min-w-0 items-center gap-1.5">
                <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', meta.bg, meta.color)}>
                  <AppIcon className={meta.icon} size={14} aria-label={typeLabel} />
                </span>
                <span className="truncate text-[10px] font-semibold text-foreground-700" title={typeLabel}>{typeLabel}</span>
                </div>
              </td>
              <td className="px-2 py-2 text-left align-middle">
                <p className="line-clamp-2 text-[11px] font-semibold leading-4 text-foreground-900" title={component.title}>{component.title}</p>
              </td>
              <td className="px-2 py-2 text-center align-middle text-[10px] font-semibold tabular-nums text-foreground-700">
                <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap"><Clock3 size={12} className="text-foreground-400" aria-hidden="true" />{activityExpectedTimeLabel(component)}</span>
              </td>
              <td className="px-2 py-2 text-center align-middle"><div className="flex justify-center"><KsbChips codes={activityKsbCodes(component)} /></div></td>
              <td className="px-2 py-2 text-center align-middle"><StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} size="sm" showIcon={status === 'completed'} className="whitespace-nowrap text-[10px]" /></td>
              <td className="px-2 py-2 text-center align-middle">
                {href ? <Link to={href} className={cn(
                  'inline-flex min-h-7 min-w-[64px] items-center justify-center whitespace-nowrap rounded-lg px-1.5 text-[10px] font-bold leading-none transition',
                  status === 'in-progress' ? 'bg-primary-600 text-white shadow-sm hover:bg-primary-700' : 'border border-primary-200 bg-background-50 text-primary-700 hover:border-primary-300 hover:bg-primary-50',
                )}>{activityActionLabel(status)}</Link> : <span className="inline-block whitespace-nowrap text-[10px] text-foreground-400">Not available</span>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-foreground-100 px-4 py-3">
      <p className="text-[11px] font-medium text-foreground-500">
        Showing {visibleComponents.length} of {filteredComponents.length} activities
      </p>
      <PaginationControls page={safePage} pageCount={pageCount} onPageChange={setPage} label="activities" className="col-start-3 justify-self-end" />
    </div>
    </>}
  </div>;
}

function activityTypeLabel(component: JourneyComponent): string {
  return (component.type || 'activity').replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function WeeklyLearningPlanSkeleton() {
  return <section aria-busy="true" aria-label="Loading your weekly learning plan" className="col-span-full grid w-full min-w-0 grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
    <Panel>
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground-400"><BookOpen size={16} aria-hidden="true" />Weeks</div>
      <RowsSkeleton rows={4} avatar={false} />
    </Panel>
    <Panel><RowsSkeleton rows={4} /></Panel>
  </section>;
}
