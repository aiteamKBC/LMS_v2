import { useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { formatHoursMinutes, parseHours, trainingPlanWeekPosition } from '@/utils/learnerJourney';
import { RowsSkeleton } from '@/components/feature/Skeletons';
// Explicit, not auto-imported: vitest.config.ts leaves unplugin-auto-import out,
// so a test that renders this view would crash on it (same reason as Modal.tsx).
import { AppIcon } from '@/components/feature/AppIcon';
import { otjhContributionHours } from '@/utils/otjhContribution';
import type { StudentActivityResponse } from '@/api/studentActivity';

const learnerNav = roleNavMap.learner;

/* ═══════════════════════════════════════════════════════
   REAL Off-the-Job Hours — driven entirely by the learner's
   backend data (Completed/Target/Planned hours, OTJHoursStatus,
   and an activity log built from quiz attempts + video watches).
   Mock-only concepts (validated/paid lifecycle, monthly chart)
   are intentionally omitted — there's no real signal for them.
   ═══════════════════════════════════════════════════════ */

interface LogRow {
  title: string;
  type: string;      // "Quiz" | "Video" | "Reading" | "Assignment" | …
  icon: string;
  tint: string;
  at: string;        // ISO
  ksbs: string[];
  /** What this activity put towards the total, in hours — the actual. */
  hours: number;
  /** The authored off-the-job hours for this activity: what the plan budgeted,
   *  independent of how long the learner took. NaN when the activity carries
   *  no authored figure. */
  planned: number;
  /** What the learner said it took, shown under the contribution when they differ. */
  reported: string;
  /** One row per quiz/component; repeats of the same one are folded in here. */
  dedupeKey: string;
  /** Total attempts made; shown as a note while only the highest value counts. */
  attemptCount: number;
  passed?: boolean;
  isQuiz: boolean;
}

/**
 * The hours one activity contributed, by the same rule the backend totals with
 * (see active_users.completed_hours_from_progress): prefer the explicit Time
 * spent input, then the reflection time, then the verified timer. Older rows
 * without any of those fall back to the component's authored OTJ hours.
 * A bare reported number is hours up to 24 and minutes above it — the same
 * reading _reported_minutes applies, so this panel cannot disagree with the
 * "Completed" figure beside it.
 */
/** "reading" -> "Reading", "live_session" -> "Live session". */
function activityTypeLabel(type: string): string {
  const words = String(type || 'Activity').replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

const TYPE_ICONS: Record<string, { icon: string; tint: string }> = {
  video: { icon: 'ri-play-circle-line', tint: 'bg-red-100 text-red-600' },
  reading: { icon: 'ri-book-open-line', tint: 'bg-blue-100 text-blue-600' },
  podcast: { icon: 'ri-mic-line', tint: 'bg-violet-100 text-violet-600' },
  powerpoint: { icon: 'ri-slideshow-line', tint: 'bg-amber-100 text-amber-600' },
  assignment: { icon: 'ri-file-edit-line', tint: 'bg-emerald-100 text-emerald-600' },
  reflection: { icon: 'ri-chat-quote-line', tint: 'bg-primary-100 text-primary-600' },
  live_session: { icon: 'ri-team-line', tint: 'bg-secondary-100 text-secondary-600' },
};

const RAG = (status: string | null | undefined) =>
  !status ? { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' }
    : /at risk/i.test(status) ? { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' }
    : /attention/i.test(status) ? { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' }
    : { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' };

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

function combinedSubjectRows(data: StudentActivityResponse): LogRow[] {
  // Last_audit can place one source activity in more than one subject. Match
  // its backend total exactly: keep every subject card, but count that source
  // activity's recorded time once.
  const historical = new Map<number, typeof data.activities[number]>();
  for (const item of data.activities) {
    const previous = historical.get(item.source_activity_id);
    if (!previous || (!previous.hours_mapped && item.hours_mapped)) {
      historical.set(item.source_activity_id, item);
    }
  }
  const oldRows: LogRow[] = [...historical.values()]
    // A mapped zero means the audit knows about the field, not that the
    // learner recorded time. It must not appear as a logged-time entry.
    .filter((item) => item.hours_mapped && Number(item.actual) > 0)
    .map((item) => {
      const type = activityTypeLabel(item.category);
      const look = TYPE_ICONS[String(item.category || '').toLowerCase()];
      return {
        title: decodeHtmlEntities(item.activity),
        type,
        icon: look?.icon || 'ri-check-double-line',
        tint: look?.tint || 'bg-primary-100 text-primary-600',
        // The scheduled Builder date can change later. An activity log needs
        // the original recorded/source date, with schedule only as fallback.
        at: item.source_date || item.date || '',
        ksbs: [],
        hours: item.actual,
        planned: item.planned_hours_mapped ? item.planned : Number.NaN,
        reported: '',
        dedupeKey: `legacy:${item.source_activity_id}`,
        attemptCount: Math.max(1, item.new_attempt_count || 0),
        passed: item.completed,
        isQuiz: /quiz/i.test(item.category),
      };
    });

  const directRows: LogRow[] = (data.direct_otjh_activities || []).map((item) => {
    const type = item.kind === 'quiz' ? 'Quiz' : activityTypeLabel(item.componentType || item.kind);
    const look = TYPE_ICONS[String(item.componentType || item.kind || '').toLowerCase()];
    return {
      title: decodeHtmlEntities(item.componentTitle?.trim() || type),
      type,
      icon: item.kind === 'quiz' ? 'ri-questionnaire-line' : look?.icon || 'ri-check-double-line',
      tint: item.kind === 'quiz'
        ? item.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
        : look?.tint || 'bg-primary-100 text-primary-600',
      at: item.submittedAt || '',
      ksbs: [],
      hours: otjhContributionHours(item),
      planned: Number(item.expectedOtjh ?? Number.NaN),
      reported: item.reportedTime || '',
      dedupeKey: item.quizId ? `quiz:${item.quizId}` : item.componentId ? `component:${item.componentId}` : `direct:${item.submittedAt}:${item.componentTitle}`,
      attemptCount: 1,
      passed: item.passed ?? undefined,
      isQuiz: item.kind === 'quiz',
    };
  });

  const directByActivity = new Map<string, LogRow>();
  const occurrences = new Map<string, number>();
  for (const row of directRows) {
    const count = (occurrences.get(row.dedupeKey) || 0) + 1;
    occurrences.set(row.dedupeKey, count);
    const previous = directByActivity.get(row.dedupeKey);
    if (!previous || row.hours > previous.hours || (row.hours === previous.hours && row.at > previous.at)) {
      directByActivity.set(row.dedupeKey, { ...row, attemptCount: count });
    } else {
      previous.attemptCount = count;
      previous.passed = Boolean(previous.passed || row.passed);
    }
  }
  return [...oldRows, ...directByActivity.values()]
    .filter((row) => row.hours > 0)
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export function RealOtjhView({ real, loading }: { real: LearnerDetail | null; loading: boolean }) {
  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Off-the-Job Hours"
      pageSubtitle={real?.programme || 'Off-the-job training hours'}
      userName={real?.name || 'Learner'}
      userRole="Learner"
    >
      <OtjhBody real={real} loading={loading} />
    </WorkspaceShell>
  );
}

/**
 * The hours themselves, without page chrome — shared with the employer portal,
 * which shows an employer the same figures their apprentice sees.
 *
 * `audience` only swaps the second-person copy: an employer reading "your logged
 * hours" about someone else is confusing, and the numbers are identical either way.
 */
export function OtjhBody({
  real,
  loading,
  showHero = true,
  audience = 'learner',
  activityData = null,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  showHero?: boolean;
  audience?: 'learner' | 'observer';
  activityData?: StudentActivityResponse | null;
}) {
  const isObserver = audience === 'observer';
  const who = isObserver ? (real?.name?.split(' ')[0] || 'This learner') : 'You';
  const usesCombinedSubjects = activityData?.recorded_otjh_total != null;
  const completed = usesCombinedSubjects ? activityData.recorded_otjh_total! : parseHours(real?.completedHours);
  const target = usesCombinedSubjects ? 0 : parseHours(real?.targetHours);
  const planned = usesCombinedSubjects && activityData.planned_total != null
    ? activityData.planned_total
    : parseHours(real?.plannedHours ?? real?.totalExpectedOtjh);
  const progressHours = parseHours(real?.progressHours);
  const status = usesCombinedSubjects ? '' : real?.otjhStatus || 'On track';
  const rag = RAG(status);
  const plannedPercent = planned > 0 ? Math.round((completed / planned) * 100) : 0;
  const plannedMappedCount = activityData?.planned_mapped_count || 0;
  const targetPercent = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
  const planWeek = trainingPlanWeekPosition(real);
  const targetWeekLabel = planWeek?.state === 'upcoming'
    ? 'Plan has ' + planWeek.total + ' weeks'
    : planWeek
      ? 'Week ' + planWeek.current + ' of ' + planWeek.total
        + (planWeek.state === 'complete' ? ' - plan complete' : '')
      : 'Up to this week';

  // One row per activity, using its highest-value attempt. Repeats remain
  // visible through attemptCount without inflating the completed-hours total.
  const rows = useMemo<LogRow[]>(() => {
    if (activityData) return combinedSubjectRows(activityData);
    const components = new Map(
      (real?.components ?? [])
        .filter((component) => component.componentId)
        .map((component) => [String(component.componentId), component]),
    );
    const titleFor = (componentId: unknown, fallback: string) =>
      components.get(String(componentId))?.component?.trim() || fallback;
    const expectedFor = (componentId: unknown) =>
      Number(components.get(String(componentId))?.expectedOtjh ?? NaN);

    const quiz = (real?.quizAttempts ?? []).map<LogRow>((a) => ({
      title: a.componentTitle?.trim() || titleFor(a.componentId, 'Quiz'),
      type: 'Quiz', icon: 'ri-questionnaire-line',
      tint: a.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600',
      at: a.submittedAt, ksbs: a.ksbs || [],
      hours: otjhContributionHours({
        expectedOtjh: a.expectedOtjh,
        reportedTime: a.reportedTime,
        verifiedSeconds: a.verifiedSeconds,
        claimedSeconds: a.claimedSeconds,
        timeTrackingSource: a.timeTrackingSource,
      }),
      planned: Number(a.expectedOtjh ?? expectedFor(a.componentId)),
      reported: a.reportedTime || a.timeTaken || '',
      // A quiz is one activity however many attempts it took, which is how the
      // total counts it.
      dedupeKey: `quiz:${a.quizId ?? a.componentId ?? a.submittedAt}`,
      attemptCount: a.attempt || 1,
      passed: a.passed, isQuiz: true,
    }));

    const video = (real?.videoProgress ?? []).map<LogRow>((v) => ({
      title: titleFor(v.componentId, 'Video watched'),
      type: 'Video', icon: 'ri-play-circle-line', tint: 'bg-red-100 text-red-600',
      at: v.submittedAt, ksbs: v.ksbs || [],
      hours: otjhContributionHours({
        expectedOtjh: v.expectedOtjh,
        fallbackExpectedOtjh: expectedFor(v.componentId),
        reportedTime: v.reportedTime,
        verifiedSeconds: v.verifiedSeconds,
        claimedSeconds: v.claimedSeconds,
        timeTrackingSource: v.timeTrackingSource,
      }),
      planned: Number(v.expectedOtjh ?? expectedFor(v.componentId)),
      reported: v.reportedTime || v.timeTaken || '',
      dedupeKey: `component:${v.componentId || v.submittedAt}`,
      attemptCount: v.attempt || 1,
      isQuiz: false,
    }));

    const activities = (real?.componentProgress ?? []).map<LogRow>((c) => {
      const look = TYPE_ICONS[String(c.componentType || '').toLowerCase()];
      return {
        title: titleFor(c.componentId, activityTypeLabel(c.componentType)),
        type: activityTypeLabel(c.componentType),
        icon: look?.icon || 'ri-check-double-line',
        tint: look?.tint || 'bg-primary-100 text-primary-600',
        at: c.submittedAt, ksbs: c.ksbs || [],
        hours: otjhContributionHours({
          expectedOtjh: c.expectedOtjh,
          fallbackExpectedOtjh: expectedFor(c.componentId),
          reportedTime: c.reportedTime,
          verifiedSeconds: c.verifiedSeconds,
          claimedSeconds: c.claimedSeconds,
          timeTrackingSource: c.timeTrackingSource,
        }),
        planned: Number(c.expectedOtjh ?? expectedFor(c.componentId)),
        reported: c.reportedTime || c.timeTaken || '',
        dedupeKey: `component:${c.componentId || c.submittedAt}`,
        attemptCount: c.attempt || 1,
        isQuiz: false,
      };
    });

    const grouped = new Map<string, LogRow>();
    const occurrences = new Map<string, number>();
    for (const row of [...quiz, ...video, ...activities]) {
      const existing = grouped.get(row.dedupeKey);
      const occurrenceCount = (occurrences.get(row.dedupeKey) || 0) + 1;
      occurrences.set(row.dedupeKey, occurrenceCount);
      if (!existing) {
        grouped.set(row.dedupeKey, { ...row, attemptCount: Math.max(row.attemptCount, occurrenceCount) });
        continue;
      }

      const rowIsHigher = row.hours > existing.hours
        || (row.hours === existing.hours && (row.at || '') > (existing.at || ''));
      const best = rowIsHigher ? row : existing;
      grouped.set(row.dedupeKey, {
        ...best,
        attemptCount: Math.max(existing.attemptCount, row.attemptCount, occurrenceCount),
        ksbs: Array.from(new Set([...existing.ksbs, ...row.ksbs])),
        passed: Boolean(existing.passed || row.passed),
      });
    }

    return Array.from(grouped.values()).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [real, activityData]);

  const loggedHours = useMemo(() => rows.reduce((total, row) => total + row.hours, 0), [rows]);

  // The same contributions, grouped by what kind of activity they were.
  const breakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.type, (map.get(row.type) || 0) + row.hours);
    }
    const withHours = Array.from(map.entries()).filter(([, hrs]) => hrs > 0);
    const max = Math.max(1, ...withHours.map(([, hrs]) => hrs));
    const groups = withHours
      .sort((a, b) => b[1] - a[1])
      .map(([type, hrs]) => {
        const rawMinutes = hrs * 60;
        return {
          type,
          hrs,
          pct: Math.round((hrs / max) * 100),
          displayMinutes: Math.floor(rawMinutes),
          remainder: rawMinutes - Math.floor(rawMinutes),
        };
      });

    // Rounding every category independently can make the visible breakdown a
    // minute higher or lower than the visible total. Allocate the remaining
    // rounded minutes by largest remainder so both displays always reconcile.
    let remaining = Math.round(loggedHours * 60)
      - groups.reduce((total, group) => total + group.displayMinutes, 0);
    const allocationOrder = [...groups].sort((a, b) => b.remainder - a.remainder || a.type.localeCompare(b.type));
    for (let index = 0; remaining > 0 && allocationOrder.length > 0; index += 1, remaining -= 1) {
      allocationOrder[index % allocationOrder.length].displayMinutes += 1;
    }
    return groups;
  }, [rows, loggedHours]);

  return (
    <div className={showHero ? 'p-3 md:p-6 space-y-5 md:space-y-6' : 'space-y-4 md:space-y-5'}>
        {/* Hero */}
        {showHero && (
        <section className="relative min-h-[170px] overflow-hidden rounded-3xl border border-primary-700/40 p-6 text-white shadow-[0_18px_45px_rgba(35,8,76,0.20)] md:p-7" style={{ background: 'linear-gradient(115deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 45%, oklch(var(--primary-700)) 100%)' }}>
          <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-primary-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-36 right-36 h-72 w-72 rounded-full bg-secondary-400/15 blur-3xl" />
          <div className="relative flex min-h-[110px] flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${rag.bg} ${rag.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${rag.dot}`} />{usesCombinedSubjects ? `${activityData?.module_count || 0} subjects` : status}
              </span>
              <h1 className="mt-3 text-2xl font-heading font-bold tracking-tight !text-white md:text-3xl">Off-the-Job Training Hours</h1>
              <p className="mt-1 max-w-xl text-sm !text-white/65">
                {isObserver ? `${who}'s logged` : 'Your logged'} learning hours from completed quizzes, videos and learning activities.
              </p>
            </div>
            <div className="flex w-full shrink-0 items-center gap-4 rounded-2xl border border-white/15 bg-white/10 p-4 shadow-lg shadow-black/10 backdrop-blur-md md:w-auto md:min-w-[260px]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-emerald-300">
                <AppIcon className="ri-time-line text-xl" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wider !text-white/55">Hours completed</p>
                    <p className="mt-1 text-2xl font-heading font-bold tabular-nums leading-none !text-white">{formatHoursMinutes(completed)}</p>
                  </div>
                  {!usesCombinedSubjects && <span className="text-xs font-bold text-emerald-300">{plannedPercent}%</span>}
                </div>
                {!usesCombinedSubjects && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-emerald-300 transition-all duration-700" style={{ width: `${Math.min(100, plannedPercent)}%` }} />
                </div>}
                <p className="mt-1.5 text-[10px] !text-white/55">
                  {usesCombinedSubjects ? `Partial mapped plan: ${formatHoursMinutes(planned)}` : `of ${formatHoursMinutes(planned)} programme hours`}
                </p>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Stat strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 md:gap-4">
          <StatCard icon="ri-flag-line" iconTint="bg-gradient-to-br from-[#d8c9ff] via-[#8b5cf6] to-[#5420a8] text-white shadow-sm shadow-primary-500/25" label="Completed" value={formatHoursMinutes(completed)} sub={usesCombinedSubjects ? 'recorded across all subjects' : `${plannedPercent}% of plan`} />
          {usesCombinedSubjects
            ? <StatCard icon="ri-stack-line" iconTint="bg-gradient-to-br from-[#ddd6fe] via-[#a78bfa] to-[#6d28d9] text-white shadow-sm shadow-violet-500/25" label="Recorded scope" value={`${activityData?.module_count || 0} subjects`} sub="historical and current learning" />
            : <StatCard icon="ri-focus-3-line" iconTint="bg-gradient-to-br from-[#ddd6fe] via-[#a78bfa] to-[#6d28d9] text-white shadow-sm shadow-violet-500/25" label="Current target" value={formatHoursMinutes(target)} sub={targetWeekLabel} />}
          <StatCard icon="ri-calendar-todo-line" iconTint="bg-gradient-to-br from-[#e5e7eb] via-[#9ca3af] to-[#4b5563] text-white shadow-sm shadow-foreground-400/25" label={usesCombinedSubjects ? 'Partial mapped plan' : 'Programme plan'} value={formatHoursMinutes(planned)} sub={usesCombinedSubjects ? `${plannedMappedCount.toLocaleString()} ${plannedMappedCount === 1 ? 'activity carries' : 'activities carry'} planned time` : 'total planned hours'} />
        </div>

        {/* Progress vs target */}
        {!usesCombinedSubjects && <section className="rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm md:p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-heading font-semibold text-foreground-900">Progress against current target</h2>
            <span className="text-xs text-foreground-400">{formatHoursMinutes(completed)} / {formatHoursMinutes(target)}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-background-200">
            <div className={`h-full rounded-full transition-all duration-700 ${rag.dot}`} style={{ width: `${targetPercent}%` }} />
          </div>
          <p className="text-[11px] text-foreground-400 mt-1.5">
            {progressHours < 0
              ? `${formatHoursMinutes(Math.abs(progressHours))} behind the ${formatHoursMinutes(target)} ${isObserver ? 'due' : 'you should have logged'} by now.`
              : isObserver
                ? `On or ahead of the ${formatHoursMinutes(target)} target for this point in the programme.`
                : `You're on or ahead of your ${formatHoursMinutes(target)} target — keep it up.`}
          </p>
        </section>}

        {/* Two-column: activity log + type breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5 items-start">
          <section className="overflow-hidden rounded-2xl border border-foreground-100 bg-background-50 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-foreground-100 bg-background-50 px-4 py-3.5 md:px-5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-100 text-primary-600"><AppIcon className="ri-history-line text-sm" /></span>
                <div>
                  <h2 className="text-sm font-heading font-bold text-foreground-900">Activity Log</h2>
                  <p className="text-[10px] text-foreground-400">Recorded learning activity and submitted time</p>
                </div>
              </div>
              {/* The hours as well as the count: this log is what the figure
                  above is made of, so it has to be checkable against it. */}
              <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-semibold text-foreground-500">
                {rows.length} {rows.length === 1 ? 'entry' : 'entries'} · {formatHoursMinutes(loggedHours)}
              </span>
            </div>
            {loading ? (
              <div className="p-5"><RowsSkeleton rows={4} avatar={false} /></div>
            ) : rows.length === 0 ? (
              <div className="p-5"><EmptyState text={isObserver ? 'No logged activity yet.' : 'No logged activity yet — finish a video, reading, quiz or assignment to see it here.'} /></div>
            ) : (
              <div className="max-h-[520px] divide-y divide-foreground-100 overflow-y-auto">
                {/* Column headings, so the two figures on each row are not left
                    to be guessed at. Sticky because the log scrolls. */}
                <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-foreground-100 bg-background-100/95 px-4 py-1.5 backdrop-blur md:px-5">
                  <span className="w-9 shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Activity</span>
                  <span className="hidden sm:block max-w-[160px] shrink-0" aria-hidden="true" />
                  <span className="w-16 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Planned</span>
                  <span className="w-16 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Actual</span>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-primary-50/25 md:px-5">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${r.tint}`}>
                      <AppIcon className={`${r.icon} text-[15px]`} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900 truncate">{r.title}</p>
                      <p className="text-[11px] text-foreground-400">
                        {r.type} · {fmtDate(r.at)}
                        {r.attemptCount > 1 && ` · ${r.attemptCount} attempts`}
                      </p>
                    </div>
                    {r.ksbs.length > 0 && (
                      <div className="hidden sm:flex flex-wrap gap-1 max-w-[160px] justify-end">
                        {r.ksbs.slice(0, 4).map((k) => (
                          <span key={k} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-50 text-primary-600">{k}</span>
                        ))}
                        {r.ksbs.length > 4 && <span className="text-[10px] text-foreground-400">+{r.ksbs.length - 4}</span>}
                      </div>
                    )}
                    {/* Planned and actual side by side. Planned is what the
                        curriculum budgeted for the activity; actual is what the
                        learner recorded — their typed input or the tracked
                        session, whichever they submitted. Kept as separate
                        columns because the gap between them is the thing a
                        coach reads this log for. */}
                    <span className="shrink-0 w-16 text-right">
                      <span className="block text-[12px] text-foreground-500 tabular-nums">
                        {Number.isFinite(r.planned) && r.planned > 0 ? formatHoursMinutes(r.planned) : '—'}
                      </span>
                    </span>
                    <span className="shrink-0 w-16 text-right">
                      <span className={`block text-[12px] font-semibold tabular-nums ${
                        // Over the planned budget is worth noticing, not
                        // flagging: learners legitimately take longer.
                        Number.isFinite(r.planned) && r.planned > 0 && r.hours > r.planned + 0.01
                          ? 'text-amber-700'
                          : 'text-foreground-800'
                      }`}>
                        {r.hours > 0 ? formatHoursMinutes(r.hours) : '—'}
                      </span>
                    </span>
                    {r.isQuiz && (
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.passed ? 'Passed' : 'Attempted'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm lg:col-span-1 md:p-5">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary-100 text-secondary-600"><AppIcon className="ri-pie-chart-line text-sm" /></span>
              <div>
                <h2 className="text-sm font-heading font-bold text-foreground-900">By activity type</h2>
                <p className="text-[10px] text-foreground-400">Logged time distribution</p>
              </div>
            </div>
            {breakdown.length === 0 ? (
              <EmptyState text="No hours logged yet." />
            ) : (
              <div className="space-y-3">
                {breakdown.map((b) => (
                  <div key={b.type}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-foreground-700">{b.type}</span>
                      <span className="text-foreground-500 font-semibold tabular-nums">{formatHoursMinutes(b.displayMinutes / 60)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-background-200 overflow-hidden">
                      <div className="h-full rounded-full bg-primary-500" style={{ width: `${b.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
    </div>
  );
}

function StatCard({ icon, iconTint, label, value, sub }: { icon: string; iconTint: string; label: string; value: string; sub: string }) {
  return (
    <div className="coach-metric-card group transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-black/5 ${iconTint}`}><AppIcon className={`${icon} text-base`} /></span>
        <AppIcon className="ri-more-line text-sm text-foreground-200" />
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
      <p className="mt-1 text-xl font-heading font-bold leading-tight text-foreground-900 tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] text-foreground-400">{sub}</p>
    </div>
  );
}
