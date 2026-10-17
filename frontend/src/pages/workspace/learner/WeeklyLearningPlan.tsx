import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatedProgressCircle } from '@/components/ui/AnimatedProgressCircle';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Clock3, ExternalLink, Search, Users, Video } from 'lucide-react';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import type { WeeklyLearningDetail } from '@/api/weeklyLearning';
import type { PlanModule, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { useLearnerDetailParam, type LearnerDetailRefreshOnFocus } from '@/hooks/useLearnerDetailParam';
import { useWeeklyLearning, useWeeklyLearningWeek } from '@/hooks/useWeeklyLearning';
import { buildCurriculumTimeline, type CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import { learningToday } from '@/pages/learner/my-learning/subjectLearning';
import { dateLabel, ukDate, ukTime } from './overviewSchedule';
import { learnerHeaderPlan } from './learnerHeaderPlan';
import { completedComponentIds, formatHoursMinutes, ksbTypeCode, resourceTypeMeta, type JourneyComponent } from '@/utils/learnerJourney';
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
  resolveInitialWeek, weekComponents, weekOtjhHours, weekKey, weekKsbProgress, weekProgress, weekWindow, type ActivityStatus,
} from './weeklyPlanHelpers';
import planLayout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';
import { canonicalActivityRows, canonicalWeekRow } from './weeklyPlanPresentation';

type SessionRow = Extract<CurriculumRow, { kind: 'session' }>;
type ReadingWeekRow = Extract<CurriculumRow, { kind: 'reading-week' }>;
type SessionState = 'attended' | 'missed' | 'upcoming' | 'live' | 'unscheduled' | 'unmarked' | 'cancelled';

function sessionState(week: SessionRow, now: number): SessionState {
  if (!week.start) return 'unscheduled';
  const start = Date.parse(week.start);
  if (!Number.isFinite(start)) return 'unscheduled';
  if (now < start) return 'upcoming';
  const end = week.minutes != null && week.minutes > 0 ? start + week.minutes * 60_000 : null;
  if (week.attended === true) return 'attended';
  if (week.attended === false && end != null && now >= end) return 'missed';
  return end != null && now >= end ? 'unmarked' : 'live';
}

const STATUS_TONE: Record<ActivityStatus, 'positive' | 'info' | 'neutral'> = {
  completed: 'positive', 'in-progress': 'info', 'not-started': 'neutral',
};
const STATUS_LABEL: Record<ActivityStatus, string> = {
  completed: 'Completed', 'in-progress': 'In progress', 'not-started': 'Not started',
};
const ACTIVITY_PAGE_SIZE = 8;

type WeeklyLearningPlanProps = {
  kind: LearnerKind; learnerId: string; schedule: Pick<TrainingPlanDashboard, 'modules' | 'sessions' | 'moduleActivityHours'> | null; scheduleLoading: boolean; scheduleError?: string;
  canOpenActivities?: boolean;
  initialModuleId?: string | null;
};

/** The panel reads the full learner detail or the compact weekly-learning response. */
type WeeklyPlanRead = {
  real: LearnerDetail | WeeklyLearningDetail | null; loading: boolean; loadError: string | null; refresh: () => void;
  lazyWeeks?: boolean;
};

export function WeeklyLearningPlan({ refreshOnFocus = true, ...props }: WeeklyLearningPlanProps & { refreshOnFocus?: LearnerDetailRefreshOnFocus }) {
  return <WeeklyLearningPlanView {...props} read={useLearnerDetailParam(props.kind, props.learnerId, refreshOnFocus)} />;
}

/** Student Dashboard: the compact weekly-learning read, not the full learner detail. */
export function DashboardWeeklyLearningPlan(props: WeeklyLearningPlanProps) {
  const read = useWeeklyLearning(props.kind, props.learnerId, true, props.initialModuleId);
  return <WeeklyLearningPlanView key={`${props.kind}:${props.learnerId}`} {...props} read={{ ...read, lazyWeeks: true }} schedule={read.real?.schedule ?? null}
    scheduleLoading={read.loading} scheduleError={read.loadError || undefined} />;
}

function WeeklyLearningPlanView({ kind, learnerId, schedule, scheduleLoading, scheduleError, canOpenActivities = true, read }: WeeklyLearningPlanProps & {
  read: WeeklyPlanRead;
}) {
  const { real, loading: detailLoading, loadError: detailError, refresh: refreshDetail } = read;
  const compact = (real as WeeklyLearningDetail | null)?.wire;
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const today = learningToday();

  const candidateModules = useMemo<Pick<PlanModule, 'id' | 'title' | 'start_date' | 'end_date' | 'curriculumSlots'>[]>(() => compact
    ? [...new Map(compact.weeks.map(week => [week.moduleId, { id: week.moduleId, title: week.moduleTitle,
      start_date: week.startDate, end_date: week.endDate }])).values()]
    : (schedule?.modules || []).filter(module => (module.curriculumSlots?.length ?? 0) > 0), [compact, schedule]);
  const plan = useMemo(() => compact ? { modules: candidateModules } : learnerHeaderPlan(candidateModules, real || {}, today), [compact, candidateModules, real, today]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const resolvedModuleId = (selectedModuleId && candidateModules.some(module => module.id === selectedModuleId) ? selectedModuleId : null)
    || (read.lazyWeeks ? (real as WeeklyLearningDetail | null)?.selectedModuleId : null)
    || plan.modules[0]?.id || candidateModules[0]?.id || null;
  const module = candidateModules.find(item => item.id === resolvedModuleId);
  const canonicalNavigation = useMemo(() => compact?.weeks.filter(week => week.moduleId === resolvedModuleId), [compact, resolvedModuleId]);
  const navigationBySlot = useMemo(() => new Map(canonicalNavigation?.map(week => [week.slotNumber, week])), [canonicalNavigation]);

  const weeks = useMemo(() => {
    if (canonicalNavigation) return canonicalNavigation.map(week => canonicalWeekRow(week,
      compact?.selectedWeek?.id === week.id ? compact.selectedWeek.liveSession : undefined));
    const sessions = (schedule?.sessions || []).filter(session => session.moduleId === resolvedModuleId);
    return buildCurriculumTimeline(module?.curriculumSlots, sessions);
  }, [canonicalNavigation, compact, module, schedule?.sessions, resolvedModuleId]);
  const [selection, setSelection] = useState<{ moduleId: string; key: string } | null>(null);
  const initialWeekId = read.lazyWeeks && (real as WeeklyLearningDetail | null)?.selectedModuleId === resolvedModuleId
    ? (real as WeeklyLearningDetail).selectedWeekId : null;
  const initialWeek = weeks.find(week => `${week.kind === 'reading-week' ? 'reading' : 'slot'}:${resolvedModuleId}:${week.slotNumber}` === initialWeekId)
    || (canonicalNavigation ? weeks.find(week => navigationBySlot.get(week.slotNumber)?.status === 'current')
      || weeks.find(week => navigationBySlot.get(week.slotNumber)?.status === 'upcoming') || weeks.at(-1) : resolveInitialWeek(weeks, today));
  const sidebarWeek = (selection?.moduleId === resolvedModuleId && weeks.find(week => weekKey(week) === selection.key)) || initialWeek;
  const lazy = read.lazyWeeks && !!(compact || (real as WeeklyLearningDetail | null)?.weekSummaries);
  const requestedWeekId = sidebarWeek
    ? `${sidebarWeek.kind === 'reading-week' ? 'reading' : 'slot'}:${resolvedModuleId}:${sidebarWeek.slotNumber}` : null;
  const nextWeek = selection?.moduleId === resolvedModuleId
    ? weeks[weeks.findIndex(week => weekKey(week) === selection.key) + 1] : undefined;
  const adjacentWeekId = nextWeek && `${nextWeek.kind === 'reading-week' ? 'reading' : 'slot'}:${resolvedModuleId}:${nextWeek.slotNumber}`;
  const weekRead = useWeeklyLearningWeek(kind, learnerId, resolvedModuleId, requestedWeekId, !!lazy, real, adjacentWeekId);
  const weekReal = useMemo(() => compact ? null : lazy ? weekRead.data ? { ...real!, ...weekRead.data,
    components: weekRead.data.components.map(component => ({ ...component, moduleId: resolvedModuleId || undefined,
      weekId: sidebarWeek?.kind === 'session' ? sidebarWeek.weekId : undefined,
      module: module?.title || '', week: sidebarWeek?.kind === 'session' ? sidebarWeek.weekTitle || String(sidebarWeek.slotNumber) : '' })),
  } : null : real, [compact, lazy, weekRead.data, real, resolvedModuleId, sidebarWeek, module]);
  const selectedWeek = useMemo(() => {
    if (compact) return weekRead.data?.selectedWeek ? canonicalWeekRow(weekRead.data.selectedWeek, weekRead.data.selectedWeek.liveSession) : sidebarWeek;
    if (!lazy || !sidebarWeek || !weekRead.data?.schedule?.sessions) return sidebarWeek;
    return buildCurriculumTimeline(module?.curriculumSlots, weekRead.data.schedule.sessions)
      .find(week => weekKey(week) === weekKey(sidebarWeek)) || sidebarWeek;
  }, [compact, lazy, sidebarWeek, weekRead.data, module]);
  const selectedIndex = selectedWeek ? weeks.findIndex(week => weekKey(week) === weekKey(selectedWeek)) : -1;

  const completedIds = useMemo(() => completedComponentIds(weekReal), [weekReal]);
  const isTeachingWeek = selectedWeek?.kind === 'session';
  const components = useMemo(() => !isTeachingWeek ? [] : compact
    ? weekRead.data?.selectedWeek ? canonicalActivityRows(weekRead.data.selectedWeek) : []
    : weekComponents(weekReal, resolvedModuleId || undefined, (selectedWeek as SessionRow).weekId, selectedWeek?.slotNumber),
  [isTeachingWeek, compact, weekRead.data, weekReal, resolvedModuleId, selectedWeek]);
  const canonicalWeek = lazy ? weekRead.data?.selectedWeek : undefined;
  const canonical = canonicalWeek?.summary;
  const progress = canonical ? { completed: canonical.completedActivities, total: canonical.totalActivities, percent: canonical.progress }
    : weekProgress(components, completedIds);
  const ksbProgress = useMemo(() => canonical ? { achieved: canonical.achievedKsbCount, total: canonical.ksbCount,
    percent: canonical.ksbCount ? Math.round(canonical.achievedKsbCount / canonical.ksbCount * 10000) / 100 : 0,
    codes: [...new Set(canonicalWeek!.activities.flatMap(activity => activity.ksbCodes))].sort() } : weekKsbProgress(components, completedIds),
  [canonical, canonicalWeek, components, completedIds]);
  const moduleHours = (lazy ? weekRead.data?.schedule : schedule)?.moduleActivityHours?.[resolvedModuleId || ''];
  const moduleComponents = useMemo(() => weekReal?.components?.filter(component => String(component.moduleId) === String(resolvedModuleId)), [weekReal, resolvedModuleId]);
  const weekHours = canonical ? { plannedHours: canonical.plannedOtjhHours, actualHours: canonical.otjhHours, untimed: canonical.untimedActivities,
    percent: canonical.otjhHours != null && canonical.plannedOtjhHours ? Math.round(canonical.otjhHours / canonical.plannedOtjhHours * 10000) / 100 : null }
    : weekOtjhHours(components, moduleHours, moduleComponents);
  const actualHours = useMemo(() => canonicalWeek ? Object.fromEntries(canonicalWeek.activities.map(activity => [activity.id, activity.actualHours]))
    : Object.fromEntries(components.map(component => [component.componentId || '',
    weekOtjhHours([component], moduleHours, moduleComponents).actualHours])), [canonicalWeek, components, moduleHours, moduleComponents]);
  const hasSchedule = !!(compact || schedule);
  const windowForWeek = (index: number) => {
    const navigation = navigationBySlot.get(weeks[index].slotNumber);
    return navigation ? { start: navigation.startDate, end: navigation.endDate } : weekWindow(weeks, index);
  };
  const summaryBySlot = useMemo(() => new Map((real as WeeklyLearningDetail | null)?.weekSummaries
    ?.filter(item => item.moduleId === resolvedModuleId).map(item => [item.slotNumber, item])), [real, resolvedModuleId]);

  // A missing or failed schedule is different from a successful empty plan.
  // Dashboard owns its schedule read; legacy callers still supply theirs.
  if (!hasSchedule && !scheduleLoading && scheduleError) return <div role="alert"><Panel>
    <EmptyState variant="error" title="Could not load your weekly plan" description={scheduleError}
      action={<button type="button" onClick={refreshDetail}>Try again</button>} />
  </Panel></div>;
  if (!hasSchedule && !scheduleLoading && real) return <Panel>
    <EmptyState variant="error" title="Could not load your weekly plan" description="The weekly schedule response was incomplete. Please try again."
      action={<button type="button" onClick={refreshDetail}>Try again</button>} />
  </Panel>;

  return <section aria-label="Weekly learning plan" className={cn(planLayout.weeklyPlan, 'grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]')}>
    {hasSchedule && detailError && <div role="alert" className="lg:col-span-2">Your weekly plan could not refresh. {detailError}
      <button type="button" onClick={refreshDetail}>Try again</button></div>}
    {!hasSchedule ? <WeeklyLearningPlanSkeleton /> : !candidateModules.length ? <Panel className="lg:col-span-2">
      <EmptyState title="Your weekly plan will appear here" description="Once a module is assigned, its weeks and activities will show up in this space." />
    </Panel> : <>
    <aside className={cn(planLayout.weekRail, 'rounded-2xl border border-foreground-100 bg-background-50 p-3 shadow-sm')}>
      <div className="flex items-center justify-between gap-2 border-l-4 border-primary-600 pl-2">
        <h2 className="text-base font-extrabold text-foreground-950">Weeks</h2>
      </div>
      {weeks.length > 0 && <div role="group" aria-label="Week marker key" className="mt-2 px-2 text-[10px] font-medium text-foreground-600">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 leading-tight">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#6eefa0]" />Attended</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#ef4444]" />Not attended</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#94a3b8]" />Upcoming</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#8b5cf6]" />Current week</span>
          {weeks.some(week => week.kind === 'reading-week') && <span className="inline-flex items-center gap-1.5"><BookOpen size={10} aria-hidden="true" className="shrink-0 text-amber-700" />Reading week</span>}
        </div>
        <p className="mt-3 pt-4 text-foreground-500">Outer ring shows activity progress.</p>
      </div>}
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
          const { start, end } = windowForWeek(index);
          const railNavigation = navigationBySlot.get(week.slotNumber);
          const navigation = canonicalWeek?.id === railNavigation?.id ? canonicalWeek : railNavigation;
          const state = navigation?.status ?? (start > today ? 'upcoming' : end !== null && end < today ? 'past' : 'current');
          const isReadingWeek = week.kind === 'reading-week';
          const isCompleted = state === 'past';
          const isCurrent = state === 'current';
          const summary = lazy ? summaryBySlot.get(week.slotNumber) : undefined;
          const weekActivityProgress = navigation ? { completed: navigation.completedActivities, total: navigation.totalActivities, percent: navigation.progress }
            : summary?.progress ?? (week.kind === 'session'
            ? weekProgress(weekComponents(real, resolvedModuleId || undefined, week.weekId, week.slotNumber), completedIds)
            : null);
          const attendance = week.kind === 'session' ? navigation?.sessionState === 'cancelled' ? 'cancelled' : sessionState(week, now) : null;
          const markerState = isReadingWeek ? 'reading' : isCurrent && attendance !== 'attended' ? 'current' : attendance;
          const label = week.kind === 'reading-week' ? 'Reading week' : week.weekTitle || `Week ${week.sessionNumber}`;
          const subLabel = week.kind === 'reading-week' ? 'Independent study' : '';
          const range = `${dateLabel(start)}${end ? ` – ${dateLabel(end)}` : ''}`;
          const stateLabel = state === 'past' ? 'Completed' : state === 'current' ? 'Current week' : 'Upcoming';
          return <li key={weekKey(week)} className="relative pl-9">
            {index < weeks.length - 1 && <span aria-hidden="true" className="absolute left-[11px] top-8 bottom-[-0.25rem] w-px bg-foreground-200" />}
            <span role="img" aria-label={isReadingWeek ? `${label}: independent study` : `${label} session: ${attendance === 'attended' ? 'attended' : attendance === 'missed' ? 'not attended' : attendance === 'unmarked' ? 'unmarked' : attendance === 'live' ? 'in progress' : attendance === 'upcoming' ? 'upcoming' : 'not scheduled'}`}
              data-state={markerState}
              className={cn(planLayout.weekSessionStatus, 'absolute left-0 top-2 z-10')}>
              {isReadingWeek ? <BookOpen size={13} aria-hidden="true" />
                : <>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="none" strokeWidth="2" />
                    <AnimatedProgressCircle cx="12" cy="12" r="10" fill="none" strokeWidth="2" strokeLinecap="round"
                      strokeDasharray={`${weekActivityProgress?.percent ?? 0} 100`} pathLength="100" />
                  </svg>
                  <span aria-hidden="true" />
                </>}
            </span>
            {weekActivityProgress?.total ? <span role="progressbar" className="sr-only" aria-label={`${label} activity progress`}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={weekActivityProgress.percent}
              aria-valuetext={`${weekActivityProgress.completed} of ${weekActivityProgress.total} activities complete`} /> : null}
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
            {week.kind === 'session' && <HolidayNoteHint note={week.holidayNote} className="learner-dashboard-week-note mt-1.5 min-w-0 max-w-full" />}
          </li>;
        })}
      </ol>
      </> : <EmptyState size="sm" title="No weeks scheduled yet" description="This module's weekly schedule isn't available yet." className="mt-3" />}
    </aside>

    <div className={cn(planLayout.weekDetail, 'min-w-0 rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm')}>
      {!selectedWeek ? <Panel><EmptyState title="No weeks scheduled yet" description="This module's weekly schedule isn't available yet." /></Panel> : <>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-foreground-100 pb-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 border-l-4 border-primary-600 pl-3">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary-700">
            {selectedWeek.kind === 'reading-week' ? 'Reading week' : `Week ${selectedWeek.sessionNumber}`}
          </p>
          <h2 className="mt-1 text-2xl font-extrabold leading-tight text-foreground-950">
            {selectedWeek.kind === 'reading-week' ? 'Reading week' : selectedWeek.weekTitle || 'This week'}
          </h2>
          {selectedIndex >= 0 ? <p className="mt-1 text-sm font-medium text-foreground-500">
            {(() => { const { start, end } = windowForWeek(selectedIndex); return `${dateLabel(start)}${end ? ` – ${dateLabel(end)}` : ''}`; })()}
          </p> : null}
          {selectedWeek.kind === 'session' && <HolidayNoteHint note={selectedWeek.holidayNote} className="learner-dashboard-week-note mt-2.5 min-w-0 max-w-full text-xs" />}

            </div>

            {isTeachingWeek && (!lazy || weekRead.data) && <div className="grid w-full shrink-0 grid-cols-1 gap-3 sm:grid-cols-3 xl:w-[660px]">
              <WeekStatCard label="Week progress" value={`${progress.percent}%`} percent={progress.total ? progress.percent : null} tone="bg-primary-600"
                caption={`${progress.completed} of ${progress.total} activities`} />
              <WeekStatCard label="KSBs this week" value={ksbProgress.total ? `${ksbProgress.percent}%` : '—'}
                percent={ksbProgress.total ? ksbProgress.percent : null} tone="bg-emerald-600"
                caption={ksbProgress.total ? `${ksbProgress.achieved} of ${ksbProgress.total} KSBs` : 'No KSBs mapped this week'}
                title={ksbProgress.codes.join(', ') || undefined} />
              <WeekStatCard label="OTJH this week" value={weekHours.percent != null ? `${weekHours.percent}%` : '—'}
                percent={weekHours.plannedHours ? weekHours.percent : null} tone="bg-amber-500"
                caption={weekHours.actualHours == null ? 'Recorded hours unavailable' : weekHours.plannedHours
                  ? `${formatHoursMinutes(weekHours.actualHours)} of ${formatHoursMinutes(weekHours.plannedHours)} hours${weekHours.untimed ? ` · ${weekHours.untimed} untimed` : ''}`
                  : 'No expected time set'} />
            </div>}
          </div>

          {isTeachingWeek && (!lazy || weekRead.data) && <section aria-labelledby="weekly-session-heading" className="mt-5">
            {selectedWeek.start ? <LiveSessionSummary week={selectedWeek} now={now} headingId="weekly-session-heading" canJoinSession={canOpenActivities}
              derivedState={compact && canonicalWeek?.sessionState === 'cancelled' ? 'cancelled' : undefined} />
              : <p id="weekly-session-heading" className="flex min-h-[136px] items-center rounded-xl border border-foreground-100 bg-background-50 p-5 text-sm text-foreground-500">No live session is scheduled for this week.</p>}
          </section>
          }

          {!isTeachingWeek && <section aria-labelledby="weekly-session-heading" className="mt-5">
            <ReadingWeekPanel week={selectedWeek as ReadingWeekRow} />
            {lazy && weekRead.error && <div role="alert">Could not load this week. {weekRead.error}
              <button type="button" onClick={weekRead.refresh}>Try again</button></div>}
          </section>}
        </div>

        {isTeachingWeek && <section aria-labelledby="weekly-activities-heading" className="mt-5 overflow-hidden rounded-xl border border-foreground-100 bg-background-50 shadow-sm">
          <div>
            {(lazy ? weekRead.error : detailError && !real) ? <Panel><EmptyState variant="error" title="Could not load this week's activities" description={(lazy ? weekRead.error : detailError) || undefined}
              action={<button type="button" onClick={lazy ? weekRead.refresh : refreshDetail} className="rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white">Try again</button>} /></Panel>
              : (lazy ? weekRead.loading || !weekRead.data : detailLoading && !real) ? <><ActivitiesHeading count={components.length} /><Panel><RowsSkeleton rows={3} avatar={false} /></Panel></>
                : !lazy && <ActivitiesTableModern components={components} completedIds={completedIds} kind={kind} learnerId={learnerId}
                  week={selectedWeek.weekTitle} canOpenActivities={canOpenActivities} actualHours={actualHours} />}
            {lazy && <div hidden={!weekRead.data || !!weekRead.error}>
              <ActivitiesTableModern components={components} completedIds={completedIds} kind={kind} learnerId={learnerId}
                week={selectedWeek.weekTitle} canOpenActivities={canOpenActivities} actualHours={actualHours} />
            </div>}
          </div>
        </section>}
      </>}
    </div>
    </>}
  </section>;
}

/** One of the week summary cards: activities, KSBs and expected OTJ hours. */
export function WeekStatCard({ label, value, percent, tone, caption, title }: {
  label: string; value: string; percent: number | null; tone: string; caption: string; title?: string;
}) {
  return <div className="min-w-0 rounded-xl border border-foreground-100 bg-background-50 p-3.5 shadow-sm" title={title}>
    <div className="flex items-end justify-between gap-2">
      <span className="min-w-0 truncate whitespace-nowrap text-[11px] font-bold text-foreground-700">{label}</span>
      <strong className="shrink-0 whitespace-nowrap text-xl font-bold tabular-nums text-foreground-900">{value}</strong>
    </div>
    <ProgressBar percent={percent} tone={tone} height="h-2" className="mt-2" />
    <p className="mt-1.5 truncate text-[11px] font-medium text-foreground-500">{caption}</p>
  </div>;
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

export function LiveSessionSummary({ week, now, headingId, canJoinSession, derivedState }: {
  week: SessionRow; now: number; headingId: string; canJoinSession: boolean; derivedState?: SessionState;
}) {
  const start = week.start as string;
  const startMs = Date.parse(start);
  const end = week.minutes ? new Date(startMs + week.minutes * 60_000) : null;
  const hasJoinUrl = !!week.joinUrl;
  const state = derivedState ?? sessionState(week, now);
  const canJoin = state === 'live' || (state === 'upcoming' && now >= startMs - 60 * 60_000);
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
          {state === 'attended' ? 'You attended this session.' : state === 'missed' ? 'This session has ended.'
            : 'A join link has not been added yet.'}
        </p> : null}
      </div>
    </div>
    {canJoinSession && hasJoinUrl ? canJoin ? <a href={week.joinUrl!} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-800 md:min-w-[128px]">
      Join session<ExternalLink size={13} aria-hidden="true" />
    </a> : <button type="button" disabled title={state === 'upcoming' ? 'Joining opens 1 hour before the session starts.'
      : state === 'attended' ? 'You attended this session.' : 'This session has ended.'}
      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-foreground-200 px-4 text-xs font-bold text-foreground-500 md:min-w-[128px]">
      Join session<ExternalLink size={13} aria-hidden="true" />
    </button> : null}
  </div>;
}

function durationLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} min`;
}

export function ReadingWeekPanel({ week }: { week: ReadingWeekRow }) {
  return <div className="rounded-xl border border-foreground-100 bg-background-50 p-4 shadow-sm">
    <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background-100 text-foreground-500"><CalendarOff size={18} aria-hidden="true" /></span><p className="text-sm font-semibold text-foreground-900">No session this week</p></div>
    {week.holidays.length ? <ul className="mt-2 space-y-1 text-xs text-foreground-500">
      {week.holidays.map((holiday, index) => <li key={`${holiday.id || holiday.label}-${index}`}>
        {holiday.label || 'Holiday'} · {dateLabel(holiday.startDate)}{holiday.endDate && holiday.endDate !== holiday.startDate ? ` – ${dateLabel(holiday.endDate)}` : ''}
      </li>)}
    </ul> : <p className="mt-2 text-xs text-foreground-500">This delivery day is closed. Use the week for independent study.</p>}
  </div>;
}

function KsbChip({ code }: { code: string }) {
  const type = ksbTypeCode(undefined, code);
  const tone = type === 'K' ? 'border-primary-200 bg-primary-50 text-primary-700'
    : type === 'S' ? 'border-accent-200 bg-accent-50 text-accent-700'
      : type === 'B' ? 'border-secondary-200 bg-secondary-100 text-foreground-800'
        : 'border-foreground-200 bg-background-100 text-foreground-600';
  return <span data-ksb-type={type} className={cn('learner-dashboard-ksb-chip rounded-full border px-2 py-0.5 text-[11px] font-semibold', tone)}>{code}</span>;
}

export function KsbChips({ codes }: { codes: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  if (!codes.length) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-background-100 px-2 py-1 text-[10px] font-medium text-foreground-400">
        No KSB mapped
      </span>
    );
  }
  const remaining = codes.slice(2);
  return <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
    {codes.slice(0, 2).map(code => <KsbChip key={code} code={code} />)}
    {remaining.length > 0 && <>
      <button ref={triggerRef} type="button" aria-label={`Show ${remaining.length} more KSBs`}
        onClick={() => dialogRef.current?.showModal()}
        className="shrink-0 border-0 bg-transparent p-0 text-[11px] font-semibold text-primary-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
        +{remaining.length}
      </button>
      <dialog ref={dialogRef} aria-labelledby={headingId} onClose={() => triggerRef.current?.focus()}
        onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
        className="w-[min(90vw,360px)] rounded-xl border border-foreground-200 bg-background-50 p-5 text-left text-foreground-900 shadow-xl backdrop:bg-foreground-950/50">
        <div className="flex items-center justify-between gap-4">
          <h3 id={headingId} className="text-base font-bold">More KSBs</h3>
          <button type="button" onClick={() => dialogRef.current?.close()}
            className="rounded-lg border border-foreground-200 px-2.5 py-1.5 text-xs font-semibold text-foreground-700 hover:bg-background-100">Close</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{remaining.map(code => <KsbChip key={code} code={code} />)}</div>
      </dialog>
    </>}
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

export const ActivitiesTableModern = memo(function ActivitiesTableModern({ components, completedIds, kind, learnerId, week, canOpenActivities, summaries, actualHours }: {
  components: JourneyComponent[]; completedIds: Set<string>; kind: LearnerKind; learnerId: string; week?: string;
  canOpenActivities: boolean;
  actualHours?: Record<string, number | null>;
  summaries?: Record<string, { status: ActivityStatus; expectedTimeLabel: string; ksbCodes: string[] }>;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ActivityStatus>('all');
  const typeOptions = useMemo(() => Array.from(new Set(components.map(activityTypeLabel))).sort(), [components]);
  const filteredComponents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return components.filter(component => {
      const status = summaries?.[component.componentId || '']?.status ?? activityStatus(component, completedIds);
      const type = activityTypeLabel(component);
      const matchesQuery = !normalizedQuery || `${type} ${component.title}`.toLowerCase().includes(normalizedQuery);
      return matchesQuery && (typeFilter === 'all' || type === typeFilter) && (statusFilter === 'all' || status === statusFilter);
    });
  }, [components, completedIds, query, statusFilter, typeFilter, summaries]);
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
      <table className="w-full min-w-[760px] table-fixed text-left text-[10px]">
        <caption className="sr-only">This week's learning activities</caption>
        <colgroup><col className="w-9" /><col className="w-24" /><col /><col className="w-24" /><col className="w-24" /><col className="w-32" /><col className="w-24" />{canOpenActivities && <col className="w-24" />}</colgroup>
        <thead className="bg-background-100/90">
          <tr>
            {['#', 'Type', 'Title', 'Expected time', 'Actual time', 'KSB mapping', 'Status', ...(canOpenActivities ? ['Action'] : [])].map(label => (
              <th key={label} scope="col" className={cn(
                'px-2 py-2 text-left text-[9px] font-bold uppercase tracking-[0.05em] text-foreground-500',
                ['Expected time', 'Actual time', 'KSB mapping', 'Status', 'Action'].includes(label) && 'text-center',
              )}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleComponents.map((component, index) => {
            const status = summaries?.[component.componentId || '']?.status ?? activityStatus(component, completedIds);
            const href = canOpenActivities ? activityHref(component, week, kind, learnerId, status === 'completed') : null;
            const typeLabel = activityTypeLabel(component);
            const meta = resourceTypeMeta(component.type || typeLabel);
            const recordedHours = actualHours?.[component.componentId || ''];
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
                <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap"><Clock3 size={12} className="text-foreground-400" aria-hidden="true" />{summaries?.[component.componentId || '']?.expectedTimeLabel ?? activityExpectedTimeLabel(component)}</span>
              </td>
              <td className="px-2 py-2 text-center align-middle text-[10px] font-semibold tabular-nums text-foreground-700">
                <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap" title={recordedHours == null ? 'Recorded hours unavailable' : 'Actual recorded time'}>
                  <Clock3 size={12} className="text-foreground-400" aria-hidden="true" />{recordedHours == null ? '—' : formatHoursMinutes(recordedHours)}
                </span>
              </td>
              <td className="px-2 py-2 text-center align-middle"><div className="flex justify-center"><KsbChips codes={summaries?.[component.componentId || '']?.ksbCodes ?? activityKsbCodes(component)} /></div></td>
              <td className="px-2 py-2 text-center align-middle"><StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} size="sm" showIcon={status === 'completed'} className="whitespace-nowrap text-[10px]" /></td>
              {canOpenActivities && <td className="px-2 py-2 text-center align-middle">
                {href ? <Link to={href} className={cn(
                  'inline-flex min-h-7 min-w-[64px] items-center justify-center whitespace-nowrap rounded-lg px-1.5 text-[10px] font-bold leading-none transition',
                  status === 'in-progress' ? 'bg-primary-600 text-white shadow-sm hover:bg-primary-700' : 'border border-primary-200 bg-background-50 text-primary-700 hover:border-primary-300 hover:bg-primary-50',
                )}>{activityActionLabel(status)}</Link> : <span className="inline-block whitespace-nowrap text-[10px] text-foreground-400">Not available</span>}
              </td>}
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
});

function activityTypeLabel(component: JourneyComponent): string {
  return (component.type || 'activity').replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function WeeklyLearningPlanSkeleton() {
  return <section aria-busy="true" aria-label="Loading your weekly learning plan" className="col-span-full grid w-full min-w-0 grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
    <Panel>
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground-400"><BookOpen size={16} aria-hidden="true" />Weeks</div>
      <RowsSkeleton rows={4} avatar={false} />
    </Panel>
    <Panel><RowsSkeleton rows={4} /></Panel>
  </section>;
}
