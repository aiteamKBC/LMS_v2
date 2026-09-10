import { useEffect, useMemo, useState } from 'react';
import { StudentMaterial } from './StudentMaterial';
import { AssignmentsTab } from './AssignmentsTab';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { LearnerPlanBody } from '@/components/feature/RealLearnerPlanView';
import { buildStations } from '@/components/feature/RealLearningJourneyView';
import { buildLinkedQuizzes, splitLinkedQuizWeek, type LinkedQuiz } from '@/utils/linkedQuizzes';
import {
  buildLearnerJourney, componentTypeMeta, gradePercent, hasComponentContent, isOpenableComponent,
  formatHoursMinutes, parseHours, type JourneyComponent, type JourneyModule,
} from '@/utils/learnerJourney';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ActionRow, RowAction } from '@/components/ui/ActionRow';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { toneStyle, statusTone, type StatusTone } from '@/lib/statusTone';
import { EMPTY_VALUE } from '@/lib/format';
import { fetchStudentActivity, type StudentActivityItem, type StudentActivityResponse } from '@/api/studentActivity';
import type { LearnerKind } from '@/api/learnerDetail';

const learnerNav = roleNavMap.learner;

type TabKey = 'overview' | 'modules' | 'quizzes' | 'assignments';

/** Training Plan and Quizzes used to be their own pages; their old URLs still
 * work (staff/coach deep-links and saved links depend on it) but now land on
 * the matching tab of this merged page instead of a separate screen. */
function defaultTabForPath(pathname: string): TabKey {
  if (pathname.startsWith('/learner/training-plan') || pathname.startsWith('/learner/modules')) return 'modules';
  if (pathname.startsWith('/learner/quizzes')) return 'quizzes';
  return 'modules';
}

export default function MyLearningPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);
  const { canProgress, showReadOnlyNotice } = useLearnerWorkspaceAccess(id);

  const [tab, setTab] = useState<TabKey>(() => new URLSearchParams(location.search).get('tab') === 'assignments' ? 'assignments' : defaultTabForPath(location.pathname));

  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const { stations, overallPct, currentIndex } = useMemo(() => buildStations(journey, real), [journey, real]);

  const completedIds = useMemo(() => new Set<string>([
    ...(real?.videoProgress || []).map((v) => v.componentId),
    ...(real?.componentProgress || []).map((c) => c.componentId),
  ]), [real]);

  // The "you are here" week — the first, in plan order, that isn't fully done.
  const currentWeek = useMemo(() => {
    for (const mod of journey) {
      for (const w of mod.weeks) {
        const openable = w.components.filter(hasComponentContent);
        const done = openable.filter((c) => c.isQuiz ? (c.quizAttempts?.length ?? 0) > 0 : !!c.componentId && completedIds.has(c.componentId)).length;
        if (openable.length > 0 && done < openable.length) return { module: mod.module, week: w };
      }
    }
    return null;
  }, [journey, completedIds]);

  const otj = useMemo(() => {
    const completedHours = parseHours(real?.completedHours);
    const plannedHours = parseHours(real?.plannedHours ?? real?.totalExpectedOtjh);
    const targetHours = parseHours(real?.targetHours);
    const status = real?.otjhStatus || null;
    const targetPercent = targetHours > 0 ? Math.round((completedHours / targetHours) * 100) : 0;
    const percent = plannedHours > 0 ? Math.round((completedHours / plannedHours) * 100) : 0;
    return { completedHours, plannedHours, targetHours, status, targetPercent, percent };
  }, [real]);

  const canTake = !!(kind && id) && canProgress;

  // The next thing to open, in plan order — the "Continue Learning" CTA jumps
  // straight there instead of leaving the learner to hunt for it.
  const nextComponent = useMemo(() => {
    if (!currentWeek) return null;
    return currentWeek.week.components.find((c) => {
      if (!hasComponentContent(c)) return false;
      if (c.isQuiz) return true; // a quiz's own attempt history decides "done", not completedIds
      return c.componentId ? !completedIds.has(c.componentId) : false;
    }) || null;
  }, [currentWeek, completedIds]);

  const nextComponentHref = useMemo(() => {
    if (!nextComponent || !kind || !id || !canProgress || !currentWeek) return null;
    const q = `?module=${encodeURIComponent(currentWeek.module)}&week=${encodeURIComponent(currentWeek.week.week)}`;
    if (nextComponent.isQuiz && hasComponentContent(nextComponent)) return `/learner/quiz/${kind}/${id}/${nextComponent.quizMeta!.quizId}${q}`;
    if (nextComponent.type === 'video' && nextComponent.videoUrl && nextComponent.componentId) return `/learner/video/${kind}/${id}/${nextComponent.componentId}${q}`;
    if (isOpenableComponent(nextComponent)) return `/learner/component/${kind}/${id}/${nextComponent.componentId}${q}`;
    return null;
  }, [nextComponent, kind, id, canProgress, currentWeek]);

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const tabs: PageTabItem[] = [
    { value: 'modules', label: 'Modules' },
    { value: 'quizzes', label: 'Quizzes' },
    { value: 'assignments', label: 'Assignments' },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={loading ? 'Loading learner…' : (real?.name || 'Learner')}
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
    >
      <PageContainer>
        <PageTabs items={tabs} value={tab} onChange={(v) => setTab(v as TabKey)} label="My Learning section" />

        {!isRealMode ? (
          <Panel><EmptyState size="sm" title="No learner selected" description="Open this page from a learner record." /></Panel>
        ) : tab === 'modules' ? (
          <ModulesTab key={`${kind}:${id}`} real={real} loading={loading} loadError={loadError} kind={kind} id={id} showReadOnlyNotice={showReadOnlyNotice} />
        ) : (
          tab === 'assignments' ? <AssignmentsTab key={`${kind}:${id}`} kind={kind} id={id} /> :
          <QuizzesTab real={real} loading={loading} loadError={loadError} kind={kind} id={id} canTake={canTake} navigate={navigate} />
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════ */
function OverviewTab({
  real, loading, loadError, journey, stations, overallPct, currentIndex, currentWeek, completedIds, otj,
  nextComponentHref, onGoToModules,
}: {
  real: ReturnType<typeof useLearnerDetailParam>['real'];
  loading: boolean;
  loadError: string | null;
  journey: JourneyModule[];
  stations: ReturnType<typeof buildStations>['stations'];
  overallPct: number;
  currentIndex: number;
  currentWeek: { module: string; week: JourneyModule['weeks'][number] } | null;
  completedIds: Set<string>;
  otj: { completedHours: number; plannedHours: number; targetHours: number; status: string | null; targetPercent: number; percent: number };
  nextComponentHref: string | null;
  onGoToModules: () => void;
}) {
  const navigate = useNavigate();

  if (loading) {
    return <Panel><RowsSkeleton rows={5} /></Panel>;
  }
  if (loadError) {
    return <Panel><EmptyState size="sm" title={loadError} /></Panel>;
  }
  if (journey.length === 0) {
    return <Panel><EmptyState size="sm" title="No training plan yet" description="Your training plan will appear here once it's built." /></Panel>;
  }

  const currentStation = currentIndex >= 0 ? stations[currentIndex] : null;
  const allModulesDone = currentIndex === -1 && stations.length > 0;
  const gatewayOpen = gatewayIsOpen(real?.gatewayStartDate);
  const currentModuleLabel = currentStation
    ? currentStation.module.module
    : allModulesDone
      ? (gatewayOpen ? 'Gateway ready' : 'Modules complete')
      : EMPTY_VALUE;
  const modulesDone = stations.filter((s) => s.status === 'completed').length;

  const stageStatuses = journeyStageStatuses(real?.programmeStatus, allModulesDone, gatewayOpen);

  const nextActivities = currentWeek
    ? currentWeek.week.components.filter((c) => !(c.componentId && completedIds.has(c.componentId))).slice(0, 4)
    : [];

  return (
    <div className="space-y-4">
      {/* Programme · Current module — the two headline facts */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-0.5">
        <span className="flex items-center gap-1.5 text-[12px]">
          <AppIcon className="ri-stack-line text-[13px] text-foreground-400" />
          <span className="text-foreground-400">Programme</span>
          <span className="font-semibold text-foreground-700">{real?.programme || EMPTY_VALUE}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px]">
          <AppIcon className="ri-flag-2-line text-[13px] text-foreground-400" />
          <span className="text-foreground-400">Current module</span>
          <span className="font-semibold text-foreground-700">{currentModuleLabel}</span>
        </span>
      </div>

      {/* Overall Progress · OTJ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ProgressStat
          icon="ri-road-map-line" label="Overall Progress"
          value={stations.length ? `${overallPct}%` : EMPTY_VALUE}
          percent={stations.length ? overallPct : null}
          caption={stations.length ? `${modulesDone}/${stations.length} modules complete` : 'No modules yet'}
          tone="brand"
        />
        <ProgressStat
          icon="ri-time-line" label="OTJ Hours"
          value={formatHoursMinutes(otj.completedHours)}
          percent={otj.targetHours > 0 ? otj.targetPercent : otj.percent}
          caption={otj.targetHours > 0 ? `Target ${formatHoursMinutes(otj.targetHours)}${otj.status ? ` · ${otj.status}` : ''}` : `${formatHoursMinutes(otj.plannedHours)} planned`}
          tone={otj.status ? statusTone(otj.status) : 'brand'}
        />
      </div>

      {/* Continue Learning — the primary CTA */}
      <div className="rounded-2xl border border-primary-200/70 bg-primary-50/40 p-4 sm:p-5">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-primary-600">Continue learning</p>
            <p className="mt-0.5 truncate text-[14px] font-semibold text-foreground-900">
              {currentWeek ? `${currentWeek.week.week} · ${currentWeek.module}` : 'Your training plan'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (nextComponentHref ? navigate(nextComponentHref) : onGoToModules())}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary-700"
          >
            <AppIcon className="ri-play-circle-line text-[15px]" />
            Continue Learning
          </button>
        </div>
      </div>

      {/* Compact Learning Journey: Enrolment -> Current Module -> Gateway -> EPA */}
      <Panel>
        <SectionHeader title="My Apprenticeship Journey" icon="ri-road-map-line" />
        <div className="mt-4">
          <JourneyStepper
            statuses={stageStatuses}
            moduleProgress={stations.length ? (modulesDone / stations.length) * 100 : 0}
          />
        </div>
      </Panel>

      {/* Current Week / Next Activities — never the whole plan at once */}
      <Panel>
        <SectionHeader
          title="This Week"
          description={currentWeek ? `${currentWeek.week.week} · ${currentWeek.module}` : undefined}
          icon="ri-calendar-check-line"
          actions={<button type="button" onClick={onGoToModules} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">Open Modules</button>}
        />
        <div className="mt-3 space-y-2">
          {nextActivities.length === 0 ? (
            <EmptyState size="sm" icon="ri-checkbox-circle-line" title="This week is complete" description="Nice work — check Modules for what's next." />
          ) : (
            nextActivities.map((c, i) => <NextActivityRow key={c.componentId || `${c.title}-${i}`} c={c} />)
          )}
        </div>
      </Panel>

      {/* Achievements — compact, with a way out to the full page */}
      <Panel>
        <SectionHeader
          title="Achievements"
          icon="ri-trophy-line"
          actions={<Link to="/learner/rewards" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">View all</Link>}
        />
        <p className="mt-2 text-[12px] leading-relaxed text-foreground-500">
          Badges and rewards for completed activities and milestones live on your Rewards page.
        </p>
      </Panel>
    </div>
  );
}

function NextActivityRow({ c }: { c: JourneyComponent }) {
  const meta = componentTypeMeta(c.title);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-foreground-100 bg-background-50 px-3.5 py-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.bg}`}>
        <AppIcon className={`${meta.icon} text-[15px] ${meta.color}`} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{meta.label}</span>
        <span className="block truncate text-[13px] font-semibold leading-snug text-foreground-900">{meta.detail || meta.label}</span>
      </div>
      {c.expectedOtjh != null && c.expectedOtjh > 0 && (
        <span className="shrink-0 text-[11px] text-foreground-400">{formatHoursMinutes(c.expectedOtjh)}</span>
      )}
    </div>
  );
}

/** Compact card: label, value, progress bar, caption. */
function ProgressStat({ icon, label, value, percent, caption, tone = 'neutral' }: {
  icon: string; label: string; value: string; percent: number | null; caption?: string; tone?: StatusTone;
}) {
  const style = toneStyle(tone);
  return (
    <div className="coach-metric-card flex min-w-0 items-center gap-3">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-black/5 ${style.bg} ${tone === 'neutral' ? 'text-foreground-400' : style.text}`}>
        <AppIcon className={`${icon} text-xl`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-foreground-500">{label}</p>
        <p className={`mt-1 text-[22px] font-semibold leading-none tabular-nums ${tone === 'neutral' ? 'text-foreground-900' : style.text}`}>{value}</p>
        <ProgressBar percent={percent} tone={percent == null || tone === 'neutral' ? undefined : style.dot} className="mt-2.5" />
        {caption ? <p className="mt-1.5 truncate text-[12px] leading-snug text-foreground-500">{caption}</p> : null}
      </div>
    </div>
  );
}

type StageStatus = 'done' | 'current' | 'upcoming';

/** Has the cohort reached the day Gateway opens?
 *
 * The practical period runs to the cohort's end date; Gateway is a scheduled
 * point in the programme, not a reward for finishing the modules early. A
 * learner with no cohort date on file is not held back by a date we do not
 * have — their modules being complete is then all there is to go on. */
export function gatewayIsOpen(gatewayStartDate: string | null | undefined, today = new Date()): boolean {
  const date = (gatewayStartDate || '').trim();
  if (!date) return true;
  // Compared as calendar days: a cohort's gateway date is a date, not an
  // instant, so it opens at the start of that day in the reader's timezone.
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return todayIso >= date.slice(0, 10);
}

/** Best-effort mapping of the freeform `programmeStatus` string (plus whether
 * every module is finished, and whether the cohort has reached Gateway) onto
 * the four fixed checkpoints. There's no dedicated gateway/EPA boolean on the
 * learner record, so this reads the same status text a coach would.
 *
 * Finishing every module early does NOT move a learner to Gateway — that told
 * a learner they were Gateway-ready a year before their cohort's gateway date.
 * A coach who has actually moved them on (the status text says gateway, EPA or
 * achieved) still wins: that is a decision about this learner, not an inference
 * from a date. */
function journeyStageStatuses(
  programmeStatus: string | null | undefined,
  allModulesDone: boolean,
  gatewayOpen: boolean,
): StageStatus[] {
  const s = (programmeStatus || '').trim().toLowerCase();
  const isEpaStage = /\bepa\b|end.?point/.test(s);
  const isGatewayStage = /gateway/.test(s);
  const isAchieved = /complete|achiev|\bpass(ed)?\b/.test(s);

  if (isAchieved) return ['done', 'done', 'done', 'done'];
  if (isEpaStage) return ['done', 'done', 'done', 'current'];
  if (isGatewayStage) return ['done', 'done', 'current', 'upcoming'];
  if (allModulesDone && gatewayOpen) return ['done', 'done', 'current', 'upcoming'];
  // Modules finished but Gateway still ahead: the learner stays on the module
  // stage, which is where the programme still has them.
  return ['done', 'current', 'upcoming', 'upcoming'];
}

const JOURNEY_STAGES = [
  { key: 'enrolment', label: 'Enrolment', icon: 'ri-user-add-line' },
  { key: 'module', label: 'Current Module', icon: 'ri-book-2-line' },
  { key: 'gateway', label: 'Gateway', icon: 'ri-flag-2-line' },
  { key: 'epa', label: 'EPA', icon: 'ri-trophy-line' },
];

function JourneyStepper({ statuses, moduleProgress }: { statuses: StageStatus[]; moduleProgress: number }) {
  return (
    <div className="flex items-start">
      {JOURNEY_STAGES.map((stage, i) => {
        const status = statuses[i];
        const dotCls = status === 'done'
          ? 'bg-emerald-500 text-white'
          : status === 'current'
            ? 'bg-primary-500 text-white'
            : 'bg-background-200 text-foreground-400';
        const labelCls = status === 'done'
          ? 'text-foreground-700'
          : status === 'current'
            ? 'font-semibold text-primary-700'
            : 'text-foreground-400';
        const linePercent = status === 'done'
          ? 100
          : stage.key === 'module' ? Math.max(0, Math.min(100, moduleProgress)) : 0;
        return (
          <div key={stage.key} className={`flex items-start ${i < JOURNEY_STAGES.length - 1 ? 'flex-1' : 'shrink-0'}`}>
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${dotCls}`}>
                <AppIcon className={`${status === 'done' ? 'ri-check-line' : stage.icon} text-sm`} />
              </span>
              <span className={`whitespace-nowrap text-[10px] ${labelCls}`}>{stage.label}</span>
            </div>
            {i < JOURNEY_STAGES.length - 1 && (
              <div
                className="mx-1.5 mt-4 h-0.5 min-w-[16px] flex-1 overflow-hidden rounded-full bg-background-200"
                role={stage.key === 'module' ? 'progressbar' : undefined}
                aria-label={stage.key === 'module' ? 'Modules completed' : undefined}
                aria-valuemin={stage.key === 'module' ? 0 : undefined}
                aria-valuemax={stage.key === 'module' ? 100 : undefined}
                aria-valuenow={stage.key === 'module' ? linePercent : undefined}
              >
                <div
                  className="h-full rounded-full bg-emerald-400 transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${linePercent}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MODULES TAB — the old Training Plan, reused and tightened
   ═══════════════════════════════════════════════════════ */
export function ModulesTab({ real, loading, loadError, kind, id, showReadOnlyNotice }: {
  real: ReturnType<typeof useLearnerDetailParam>['real'];
  loading: boolean;
  loadError: string | null;
  kind?: LearnerKind;
  id?: string;
  showReadOnlyNotice: boolean;
}) {
  const [activityData, setActivityData] = useState<StudentActivityResponse | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRetry, setActivityRetry] = useState(0);
  const activityAvailable = !loading && !loadError && !!real?.studentActivityAvailable;

  useEffect(() => {
    if (!activityAvailable || !kind || !id) return;
    const controller = new AbortController();
    setActivityLoading(true);
    setActivityError(null);
    setActivityData(null);
    void fetchStudentActivity(kind, id, controller.signal).then((data) => {
      if (!controller.signal.aborted) setActivityData(data);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setActivityError(error instanceof Error ? error.message : 'Could not load student activity.');
    }).finally(() => {
      if (!controller.signal.aborted) setActivityLoading(false);
    });
    return () => controller.abort();
  }, [activityAvailable, kind, id, activityRetry]);

  return (
    <div className="space-y-3">
      <SectionHeader
        title="Modules"
        description={activityAvailable ? 'Your recorded modules, activities and OTJ hours' : 'Your training plan, week by week'}
        icon="ri-book-2-line"
      />
      {showReadOnlyNotice && !activityAvailable && (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary-200/70 bg-primary-50/60 px-3.5 py-2.5">
          <AppIcon className="ri-eye-line mt-0.5 shrink-0 text-[15px] text-primary-600" />
          <p className="text-[12px] leading-snug text-foreground-600">
            <span className="font-semibold text-foreground-800">Viewing read-only.</span>{' '}
            Only the learner can complete activities, upload evidence or submit reflections.
          </p>
        </div>
      )}
      {activityAvailable && kind && id ? (
        <StudentActivityPanel
          kind={kind} learnerId={id}
          data={activityData}
          loading={activityLoading}
          error={activityError}
          onRetry={() => setActivityRetry((value) => value + 1)}
        />
      ) : <LearnerPlanBody
        real={real}
        loading={loading}
        loadError={loadError}
        pageLabel="Modules"
        kind={kind}
        learnerId={id}
        showHero={false}
        compact
      />}
      {activityAvailable && ((real?.modules?.length || 0) > 0 || (real?.components?.length || 0) > 0) && (
        <div className="space-y-3 pt-4">
          <SectionHeader title="Current training plan" description="Your current learning activities" icon="ri-book-2-line" />
          <LearnerPlanBody real={real} loading={loading} loadError={loadError} pageLabel="Modules" kind={kind} learnerId={id} showHero={false} compact />
        </div>
      )}
    </div>
  );
}

export function StudentActivityPanel({ data, loading, error, onRetry, kind, learnerId }: {
  kind?: string;
  learnerId?: string;
  data: StudentActivityResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const modules = useMemo(() => {
    const grouped = new Map<number, { id: number; name: string; activities: StudentActivityItem[] }>();
    for (const item of data?.activities || []) {
      const group = grouped.get(item.group_id) || {
        id: item.group_id,
        name: item.group_name || 'Unnamed module',
        activities: [],
      };
      group.activities.push(item);
      grouped.set(item.group_id, group);
    }
    const term = search.trim().toLocaleLowerCase();
    return [...grouped.values()]
      .map((group) => ({ ...group, visibleActivities: term && !group.name.toLocaleLowerCase().includes(term)
        ? group.activities.filter((item) => item.activity.toLocaleLowerCase().includes(term))
        : group.activities }))
      .filter((group) => group.visibleActivities.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, search]);

  const toggleModule = (groupId: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  return (
      <section aria-labelledby="student-activity-title" className="overflow-hidden rounded-2xl border border-foreground-200 bg-white">
        <header className="flex items-center justify-between border-b border-foreground-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-600">Last audit</p>
            <h2 id="student-activity-title" className="mt-0.5 text-lg font-bold text-foreground-900">Modules and activities</h2>
            {data && <p className="mt-0.5 text-[12px] text-foreground-500">{data.learner_name}</p>}
            <p className="mt-1 text-[12px] text-foreground-500">Historical records · Read-only</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <RowsSkeleton rows={6} />
          ) : error ? (
            <EmptyState
              size="sm"
              variant="error"
              title="Could not load student activity"
              description={error}
              action={<button type="button" onClick={onRetry} className="rounded-lg border border-foreground-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Try again</button>}
            />
          ) : !data ? null : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <ActivityStat label="Modules" value={data.module_count} />
                <ActivityStat label="Activities" value={data.count} />
                <ActivityStat label="Completed" value={data.completed_count} />
                <ActivityStat label="Recorded OTJH" value={data.actual_total == null ? 'Unavailable' : formatHoursMinutes(data.actual_total)} />
                <ActivityStat label="Planned OTJH" value={data.planned_total == null ? 'Unavailable' : formatHoursMinutes(data.planned_total)} />
              </div>
              <p className="text-[12px] text-foreground-500">
                OTJ hours available for {data.mapped_count} of {data.unique_activity_count} unique activities; planned hours for {data.planned_mapped_count}.
                {' '}Totals exclude attendance and separate assignment records. Shared activities count once. Missing hours are shown as unavailable, so totals may be incomplete.
              </p>
              <label className="relative block">
                <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
                <input aria-label="Search modules or activities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search modules or activities" className="h-10 w-full rounded-xl border border-foreground-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
              {modules.length === 0 ? (
                <EmptyState size="sm" title={data.count ? 'No activities match this search' : 'No recorded activities for this learner'} />
              ) : (
                <div className="space-y-2">
                  {modules.map((module) => {
                    const isExpanded = expanded.has(module.id);
                    const complete = module.activities.filter((item) => item.completed).length;
                    return (
                      <div key={module.id} className="overflow-hidden rounded-xl border border-foreground-200 bg-white">
                        <button type="button" aria-expanded={isExpanded} onClick={() => toggleModule(module.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-background-100/70">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><AppIcon className="ri-book-open-line text-base" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-foreground-900">{module.name}</span>
                            <span className="block text-[11px] text-foreground-500">{complete} of {module.activities.length} completed</span>
                            <span className="block text-[11px] text-foreground-500">Recorded OTJH: {module.activities.some((item) => item.hours_mapped) ? formatHoursMinutes(module.activities.reduce((sum, item) => sum + (item.hours_mapped ? item.actual : 0), 0)) : 'Unavailable'}</span>
                          </span>
                          <AppIcon className={`${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg text-foreground-500`} />
                        </button>
                        {isExpanded && (
                          <div className="divide-y divide-foreground-100 border-t border-foreground-100">
                            {module.visibleActivities.map((item) => <StudentActivityRow key={item.activity_id} item={item} kind={kind} learnerId={learnerId} />)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
  );
}

function ActivityStat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl border border-foreground-100 bg-background-100/60 px-3 py-2.5"><p className="text-[10px] uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-0.5 text-lg font-bold text-foreground-900">{value}</p></div>;
}

function StudentActivityRow({ item, kind, learnerId }: { item: StudentActivityItem; kind?: string; learnerId?: string }) {
  const [open, setOpen] = useState(false);
  const materialMeta = componentTypeMeta(item.category);
  const score = item.quiz_score != null && item.quiz_maximum_score
    ? `${item.quiz_score}/${item.quiz_maximum_score}`
    : null;
  return (
    <div><div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${materialMeta.bg}`}>
        <AppIcon className={`${materialMeta.icon} text-[14px] ${materialMeta.color}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-foreground-800">{item.activity}</p>
        <p className="mt-0.5 text-[10px] text-foreground-500">{[item.category, item.date, score].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="text-right text-[11px] text-foreground-500">
        <span className="block">OTJH: {item.hours_mapped ? formatHoursMinutes(item.actual) : 'Unavailable'}</span>
        <span className="block">Planned: {item.planned_hours_mapped ? formatHoursMinutes(item.planned) : 'Unavailable'}</span>
      </span>
      <StatusBadge tone={item.completed ? 'positive' : 'neutral'} label={item.completed ? 'Completed' : (item.status || 'Not started')} />
      {kind && learnerId && <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="rounded-lg border px-3 py-2 text-sm font-semibold text-primary-700">{open ? 'Close material' : 'Open material'}</button>}
    </div>
    {open && kind && learnerId && <StudentMaterial kind={kind} learnerId={learnerId} groupId={item.group_id} activityId={item.source_activity_id} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUIZZES TAB — compact filterable list, replacing the big cards
   ═══════════════════════════════════════════════════════ */
type QuizFilter = 'all' | 'todo' | 'completed' | 'failed';

function QuizzesTab({ real, loading, loadError, kind, id, canTake, navigate }: {
  real: ReturnType<typeof useLearnerDetailParam>['real'];
  loading: boolean;
  loadError: string | null;
  kind?: string;
  id?: string;
  canTake: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [filter, setFilter] = useState<QuizFilter>('all');
  const quizzes = useMemo(() => buildLinkedQuizzes(real), [real]);

  const rows = useMemo(() => quizzes.map((q) => {
    const attempts = q.attempts;
    const best = attempts.length ? attempts.reduce((b, a) => (gradePercent(a.grade) > gradePercent(b.grade) ? a : b)) : null;
    const status: QuizFilter = !best ? 'todo' : best.passed ? 'completed' : 'failed';
    return { ...q, best, status };
  }), [quizzes]);

  const counts = useMemo(() => ({
    all: rows.length,
    todo: rows.filter((r) => r.status === 'todo').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  }), [rows]);

  const tabs: PageTabItem[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'todo', label: 'To Do', count: counts.todo },
    { value: 'completed', label: 'Completed', count: counts.completed, tone: 'positive' },
    { value: 'failed', label: 'Failed', count: counts.failed, tone: 'critical', hideWhenEmpty: true },
  ];

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="space-y-3">
      <SectionHeader title="Quizzes" description="Every quiz linked to your training plan" icon="ri-questionnaire-line" />
      <PageTabs items={tabs} value={filter} onChange={(v) => setFilter(v as QuizFilter)} label="Filter quizzes" />

      {loading ? (
        <Panel><RowsSkeleton rows={4} /></Panel>
      ) : loadError ? (
        <Panel><EmptyState size="sm" title={loadError} /></Panel>
      ) : quizzes.length === 0 ? (
        <Panel><EmptyState size="sm" title="No quizzes linked yet" description="Quizzes linked to your training plan will appear here." /></Panel>
      ) : filtered.length === 0 ? (
        <Panel><EmptyState size="sm" title="No quizzes match this filter" /></Panel>
      ) : (
        <Panel padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60 bg-background-100/60">
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Quiz</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Week</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Date</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Score</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground-100">
                {filtered.map((q) => (
                  <QuizListRow key={q.quizId} quiz={q} canTake={canTake} onTake={() =>
                    navigate(`/learner/quiz/${kind}/${id}/${q.quizId}?module=${encodeURIComponent(q.module || '')}&week=${encodeURIComponent(q.week || '')}`)
                  } />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function QuizListRow({ quiz, canTake, onTake }: {
  quiz: LinkedQuiz & { best: LinkedQuiz['attempts'][number] | null; status: QuizFilter };
  canTake: boolean;
  onTake: () => void;
}) {
  const { best, status } = quiz;
  const { label: weekLabel, date: weekDate } = splitLinkedQuizWeek(quiz.week);
  return (
    <tr className="transition-colors hover:bg-background-100/40">
      <td className="px-4 py-3">
        <p className="text-[13px] font-semibold text-foreground-900">{quiz.name}</p>
        {quiz.module && <p className="text-[11px] text-foreground-400">{quiz.module}</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-foreground-600">{weekLabel || EMPTY_VALUE}</td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-foreground-600">{weekDate || EMPTY_VALUE}</td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] font-semibold text-foreground-800">
        {best ? `${gradePercent(best.grade)}%` : EMPTY_VALUE}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge
          tone={status === 'completed' ? 'positive' : status === 'failed' ? 'critical' : 'neutral'}
          label={status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'To do'}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {canTake && <RowAction label={best ? 'Retake' : 'Start'} emphasis={status === 'todo' ? 'primary' : 'secondary'} onClick={onTake} />}
      </td>
    </tr>
  );
}
