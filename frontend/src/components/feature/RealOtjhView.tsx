import { useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { formatHoursMinutes, parseHours } from '@/utils/learnerJourney';
import { RowsSkeleton } from '@/components/feature/Skeletons';
// Explicit, not auto-imported: vitest.config.ts leaves unplugin-auto-import out,
// so a test that renders this view would crash on it (same reason as Modal.tsx).
import { AppIcon } from '@/components/feature/AppIcon';

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
  /** What this activity put towards the total, in hours. */
  hours: number;
  /** What the learner said it took, shown under the contribution when they differ. */
  reported: string;
  /** One row per quiz/component; repeats of the same one are folded in here. */
  dedupeKey: string;
  passed?: boolean;
  isQuiz: boolean;
}

/**
 * The hours one activity contributed, by the same rule the backend totals with
 * (see active_users.completed_hours_from_progress): the time the learner
 * actually recorded on submission, and only for rows predating time tracking
 * the component's authored off-the-job hours. A bare number in that fallback is
 * hours up to 24 and minutes above it — the same reading _reported_minutes
 * applies, so this panel cannot disagree with the "Completed" figure beside it.
 */
function contributedHours(
  expectedOtjh: unknown,
  reported: string,
  fallback?: number,
  verifiedSeconds?: unknown,
): number {
  // What the learner actually did, and so what the activity is worth.
  const verified = Number(verifiedSeconds);
  if (Number.isFinite(verified) && verified >= 0 && verifiedSeconds != null) return verified / 3600;
  const expected = Number(expectedOtjh);
  if (Number.isFinite(expected) && expected > 0) return expected;
  const text = String(reported || '').trim().toLowerCase();
  if (text) {
    if (text.includes(':')) {
      const [minutes, seconds] = text.split(':').map(Number);
      if (Number.isFinite(minutes)) return (minutes + (Number.isFinite(seconds) ? seconds / 60 : 0)) / 60;
    }
    const hours = Number(text.match(/([\d.]+)\s*(?:hours?|hrs?|h)\b/)?.[1] || 0);
    const minutes = Number(text.match(/([\d.]+)\s*(?:minutes?|mins?|m)\b/)?.[1] || 0);
    if (hours || minutes) return hours + minutes / 60;
    const bare = Number(text.match(/[\d.]+/)?.[0] || 0);
    if (bare) return bare > 24 ? bare / 60 : bare;
  }
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

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
}: {
  real: LearnerDetail | null;
  loading: boolean;
  showHero?: boolean;
  audience?: 'learner' | 'observer';
}) {
  const isObserver = audience === 'observer';
  const who = isObserver ? (real?.name?.split(' ')[0] || 'This learner') : 'You';
  const completed = parseHours(real?.completedHours);
  const target = parseHours(real?.targetHours);
  const planned = parseHours(real?.plannedHours ?? real?.totalExpectedOtjh);
  const progressHours = parseHours(real?.progressHours);
  const status = real?.otjhStatus || 'On track';
  const rag = RAG(status);
  const plannedPercent = planned > 0 ? Math.round((completed / planned) * 100) : 0;
  const targetPercent = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;

  // Every completion that put hours on the total, newest first: quizzes, videos,
  // and the readings, decks, podcasts and assignments finished through the
  // component runner. Those last were missing, so a learner whose hours came
  // from them saw a log that did not account for the number above it.
  const rows = useMemo<LogRow[]>(() => {
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
      title: `Quiz attempt${a.attempt ? ` #${a.attempt}` : ''}`,
      type: 'Quiz', icon: 'ri-questionnaire-line',
      tint: a.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600',
      at: a.submittedAt, ksbs: a.ksbs || [],
      hours: contributedHours(a.expectedOtjh, a.reportedTime || a.timeTaken || '', undefined, a.verifiedSeconds),
      reported: a.reportedTime || a.timeTaken || '',
      // A quiz is one activity however many attempts it took, which is how the
      // total counts it.
      dedupeKey: `quiz:${a.quizId ?? a.componentId ?? a.submittedAt}`,
      passed: a.passed, isQuiz: true,
    }));

    const video = (real?.videoProgress ?? []).map<LogRow>((v) => ({
      title: titleFor(v.componentId, 'Video watched'),
      type: 'Video', icon: 'ri-play-circle-line', tint: 'bg-red-100 text-red-600',
      at: v.submittedAt, ksbs: v.ksbs || [],
      hours: contributedHours(
        v.expectedOtjh, v.reportedTime || v.timeTaken || '', expectedFor(v.componentId), v.verifiedSeconds,
      ),
      reported: v.reportedTime || v.timeTaken || '',
      dedupeKey: `component:${v.componentId || v.submittedAt}`,
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
        hours: contributedHours(
          c.expectedOtjh, c.reportedTime || c.timeTaken || '', expectedFor(c.componentId), c.verifiedSeconds,
        ),
        reported: c.reportedTime || c.timeTaken || '',
        dedupeKey: `component:${c.componentId || c.submittedAt}`,
        isQuiz: false,
      };
    });

    return [...quiz, ...video, ...activities]
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [real]);

  // What the log accounts for. The total counts each quiz or component once
  // however many times it was completed, so the same fold is applied here —
  // otherwise a re-watched video would make this disagree with "Completed".
  const loggedHours = useMemo(() => {
    const counted = new Set<string>();
    return rows.reduce((total, row) => {
      if (counted.has(row.dedupeKey)) return total;
      counted.add(row.dedupeKey);
      return total + row.hours;
    }, 0);
  }, [rows]);

  // The same contributions, grouped by what kind of activity they were.
  const breakdown = useMemo(() => {
    const map = new Map<string, number>();
    const counted = new Set<string>();
    for (const row of rows) {
      if (counted.has(row.dedupeKey)) continue;
      counted.add(row.dedupeKey);
      map.set(row.type, (map.get(row.type) || 0) + row.hours);
    }
    const withHours = Array.from(map.entries()).filter(([, hrs]) => hrs > 0);
    const max = Math.max(1, ...withHours.map(([, hrs]) => hrs));
    return withHours
      .sort((a, b) => b[1] - a[1])
      .map(([type, hrs]) => ({ type, hrs, pct: Math.round((hrs / max) * 100) }));
  }, [rows]);

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
                <span className={`w-1.5 h-1.5 rounded-full ${rag.dot}`} />{status}
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
                  <span className="text-xs font-bold text-emerald-300">{plannedPercent}%</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-emerald-300 transition-all duration-700" style={{ width: `${Math.min(100, plannedPercent)}%` }} />
                </div>
                <p className="mt-1.5 text-[10px] !text-white/55">of {formatHoursMinutes(planned)} programme hours</p>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Stat strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 md:gap-4">
          <StatCard icon="ri-flag-line" iconTint="bg-gradient-to-br from-[#d8c9ff] via-[#8b5cf6] to-[#5420a8] text-white shadow-sm shadow-primary-500/25" label="Completed" value={formatHoursMinutes(completed)} sub={`${plannedPercent}% of plan`} />
          <StatCard icon="ri-focus-3-line" iconTint="bg-gradient-to-br from-[#ddd6fe] via-[#a78bfa] to-[#6d28d9] text-white shadow-sm shadow-violet-500/25" label="Current target" value={formatHoursMinutes(target)} sub="up to this week" />
          <StatCard icon="ri-calendar-todo-line" iconTint="bg-gradient-to-br from-[#e5e7eb] via-[#9ca3af] to-[#4b5563] text-white shadow-sm shadow-foreground-400/25" label="Programme plan" value={formatHoursMinutes(planned)} sub="total planned hours" />
        </div>

        {/* Progress vs target */}
        <section className="rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm md:p-5">
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
        </section>

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
                {rows.map((r, i) => (
                  <div key={i} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-primary-50/25 md:px-5">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${r.tint}`}>
                      <AppIcon className={`${r.icon} text-[15px]`} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900 truncate">{r.title}</p>
                      <p className="text-[11px] text-foreground-400">{r.type} · {fmtDate(r.at)}</p>
                    </div>
                    {r.ksbs.length > 0 && (
                      <div className="hidden sm:flex flex-wrap gap-1 max-w-[160px] justify-end">
                        {r.ksbs.slice(0, 4).map((k) => (
                          <span key={k} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-50 text-primary-600">{k}</span>
                        ))}
                        {r.ksbs.length > 4 && <span className="text-[10px] text-foreground-400">+{r.ksbs.length - 4}</span>}
                      </div>
                    )}
                    <span className="shrink-0 w-20 text-right">
                      <span className="block text-[12px] font-semibold text-foreground-700 tabular-nums">
                        {r.hours > 0 ? formatHoursMinutes(r.hours) : '—'}
                      </span>
                      {/* What the learner said it took, shown only when that is
                          not the same as what the component is worth — "2h ·
                          said 2h" is noise. */}
                      {r.reported && r.hours > 0
                        && Math.abs(contributedHours(0, r.reported) - r.hours) > 0.01 && (
                        <span className="block text-[10px] text-foreground-400">said {r.reported}</span>
                      )}
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
                      <span className="text-foreground-500 font-semibold tabular-nums">{formatHoursMinutes(b.hrs)}</span>
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
    <div className="group rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
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
