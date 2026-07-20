import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerCalendarEvents, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import {
  buildLearnerJourney, quizAggregateStats, parseHours, formatHoursMinutes, gradePercent, isOpenableComponent,
  type JourneyModule,
} from '@/utils/learnerJourney';

const learnerNav = roleNavMap.learner;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ═══════════════════════════════════════════════════════
   DATE / MONTH HELPERS — the monthly cycle is reconstructed
   from the learner's real dated activity (quiz attempts,
   video watches, coaching events, activity feed). No month
   is fabricated: the selector lists only months that carry
   real activity, plus the current calendar month.
   ═══════════════════════════════════════════════════════ */
/** ISO date/datetime → "YYYY-MM" bucket key, or null if unparseable. */
function ymKey(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ymLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
function ymShort(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}
/** First number found in a free-text time ("about 25 minutes" → 25). */
function parseMinutes(text?: string | null): number {
  const m = String(text ?? '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}
/** A coaching event's effective calendar date. */
function eventDate(e: LearnerCalendarEvent): string | null {
  return e.scheduledDate || e.date || e.targetDate || null;
}
function isVideoComponent(c: JourneyModule['weeks'][number]['components'][number]): boolean {
  return Boolean(c.videoUrl) || (c.type || '').toLowerCase() === 'video';
}
function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

/* ═══════════════════════════════════════════════════════
   PROGRESS DERIVATION
   ═══════════════════════════════════════════════════════ */
interface ToDate {
  overallPct: number;
  trackTotal: number;
  trackDone: number;
  quizTotal: number;
  quizPassed: number;
  quizTaken: number;
  videoTotal: number;
  videoDone: number;
  nextComponent: { title: string; kind: 'quiz' | 'video' | 'component'; module: string; week: string } | null;
}

function computeToDate(journey: JourneyModule[], real: LearnerDetail | null): ToDate {
  const watched = new Set((real?.videoProgress || []).map((v) => v.componentId));
  const completedComponents = new Set((real?.componentProgress || []).map((c) => c.componentId));
  let trackTotal = 0, trackDone = 0, quizTotal = 0, quizPassed = 0, quizTaken = 0, videoTotal = 0, videoDone = 0;
  let nextComponent: ToDate['nextComponent'] = null;

  for (const mod of journey) {
    for (const w of mod.weeks) {
      for (const c of w.components) {
        if (c.isQuiz) {
          quizTotal += 1; trackTotal += 1;
          const attempts = c.quizAttempts || [];
          if (attempts.length > 0) { quizTaken += 1; trackDone += 1; }
          else if (!nextComponent) nextComponent = { title: c.title, kind: 'quiz', module: mod.module, week: w.week };
          if (attempts.some((a) => a.passed)) quizPassed += 1;
        } else if (isVideoComponent(c)) {
          videoTotal += 1; trackTotal += 1;
          if (c.componentId && watched.has(c.componentId)) { videoDone += 1; trackDone += 1; }
          else if (!nextComponent) nextComponent = { title: c.title, kind: 'video', module: mod.module, week: w.week };
        } else if (isOpenableComponent(c)) {
          trackTotal += 1;
          if (c.componentId && completedComponents.has(c.componentId)) trackDone += 1;
          else if (!nextComponent) nextComponent = { title: c.title, kind: 'component', module: mod.module, week: w.week };
        }
      }
    }
  }
  const overallPct = trackTotal > 0 ? Math.round((trackDone / trackTotal) * 100) : 0;
  return { overallPct, trackTotal, trackDone, quizTotal, quizPassed, quizTaken, videoTotal, videoDone, nextComponent };
}

interface MonthStats {
  quizzesTaken: number;
  quizzesPassed: number;
  avgGrade: number | null;
  videosWatched: number;
  componentsDone: number;
  coachingCount: number;
  reviewCount: number;
  ksbCodes: string[];
  loggedHours: number;
  events: LearnerCalendarEvent[];
  timeline: TimelineEntry[];
}

interface TimelineEntry {
  at: string;                 // ISO date used for sorting
  dateLabel: string;
  title: string;
  detail?: string;
  icon: string;
  tone: 'quiz' | 'video' | 'component' | 'coaching' | 'review';
  status?: string;
  passed?: boolean;
  meetingLink?: string;
}

function computeMonth(real: LearnerDetail | null, events: LearnerCalendarEvent[], key: string): MonthStats {
  const quizAttempts = (real?.quizAttempts || []).filter((a) => ymKey(a.submittedAt) === key);
  const videos = (real?.videoProgress || []).filter((v) => ymKey(v.submittedAt) === key);
  const comps = (real?.componentProgress || []).filter((c) => ymKey(c.submittedAt) === key);
  const monthEvents = events.filter((e) => ymKey(eventDate(e)) === key);
  const feed = (real?.activityFeed || []).filter((f) => ymKey(f.at) === key);

  const quizIdsTaken = new Set(quizAttempts.map((a) => a.quizId));
  const quizIdsPassed = new Set(quizAttempts.filter((a) => a.passed).map((a) => a.quizId));
  const videoComps = new Set(videos.map((v) => v.componentId));
  const compDone = new Set(comps.map((c) => c.componentId));

  const grades = quizAttempts.map((a) => gradePercent(a.grade));
  const avgGrade = grades.length ? Math.round(grades.reduce((n, g) => n + g, 0) / grades.length) : null;

  const ksbSet = new Set<string>();
  for (const r of [...quizAttempts, ...videos, ...comps]) for (const code of r.ksbs || []) ksbSet.add(code);

  let loggedHours = 0;
  for (const r of [...quizAttempts, ...videos, ...comps]) loggedHours += parseMinutes(r.reportedTime) / 60;

  const coachingCount = monthEvents.filter((e) => e.type === 'coaching' || e.type === 'welfare').length;
  const reviewCount = monthEvents.filter((e) => e.type === 'review').length;

  // Unified, date-sorted timeline: real activity feed + coaching/review events.
  const timeline: TimelineEntry[] = [];
  for (const f of feed) {
    const tone: TimelineEntry['tone'] = f.kind === 'quiz' ? 'quiz' : f.kind === 'video' ? 'video' : 'component';
    const icon = f.kind === 'quiz' ? 'ri-questionnaire-line' : f.kind === 'video' ? 'ri-play-circle-line' : 'ri-checkbox-circle-line';
    timeline.push({
      at: f.at,
      dateLabel: formatDayMonth(f.at),
      title: f.title,
      detail: f.detail,
      icon,
      tone,
      passed: f.passed,
    });
  }
  for (const e of monthEvents) {
    const iso = eventDate(e)!;
    timeline.push({
      at: iso,
      dateLabel: formatDayMonth(iso),
      title: e.sequence ? `${e.title} ${e.sequence}` : e.title,
      detail: e.coachName ? `with ${e.coachName}${e.scheduledTime ? ` · ${e.scheduledTime}` : ''}` : undefined,
      icon: e.type === 'review' ? 'ri-file-list-3-line' : 'ri-user-voice-line',
      tone: e.type === 'review' ? 'review' : 'coaching',
      status: e.status,
      meetingLink: e.meetingLink || undefined,
    });
  }
  timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first

  return {
    quizzesTaken: quizIdsTaken.size,
    quizzesPassed: quizIdsPassed.size,
    avgGrade,
    videosWatched: videoComps.size,
    componentsDone: compDone.size,
    coachingCount,
    reviewCount,
    ksbCodes: Array.from(ksbSet),
    loggedHours: Math.round(loggedHours * 10) / 10,
    events: monthEvents,
    timeline,
  };
}

/* ═══════════════════════════════════════════════════════
   SMALL UI PRIMITIVES
   ═══════════════════════════════════════════════════════ */
function Ring({ pct, size = 148, stroke = 11 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="stroke-accent-400" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-heading font-bold text-white leading-none">{pct}%</span>
        <span className="text-[10px] text-white/50 uppercase tracking-wider mt-1.5 font-semibold">Readiness</span>
      </div>
    </div>
  );
}

const EVENT_STATUS_STYLE: Record<string, { label: string; cls: string; icon: string }> = {
  'scheduled': { label: 'Scheduled', cls: 'bg-primary-100 text-primary-700', icon: 'ri-calendar-check-line' },
  'in-progress': { label: 'In progress', cls: 'bg-amber-100 text-amber-700', icon: 'ri-loader-4-line' },
  'completed': { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700', icon: 'ri-checkbox-circle-line' },
  'not-scheduled': { label: 'Not scheduled', cls: 'bg-background-100 text-foreground-500', icon: 'ri-time-line' },
  'cancelled': { label: 'Cancelled', cls: 'bg-red-100 text-red-700', icon: 'ri-close-circle-line' },
};

const TONE_STYLE: Record<TimelineEntry['tone'], { dot: string; chip: string }> = {
  quiz: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
  video: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700' },
  component: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  coaching: { dot: 'bg-primary-500', chip: 'bg-primary-50 text-primary-700' },
  review: { dot: 'bg-secondary-500', chip: 'bg-secondary-50 text-secondary-700' },
};

/* ═══════════════════════════════════════════════════════
   MAIN VIEW
   ═══════════════════════════════════════════════════════ */
export function RealMonthlyCycleView({
  real, loading, loadError, learnerKind, learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  learnerKind: LearnerKind;
  learnerId: string;
}) {
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    fetchLearnerCalendarEvents(learnerKind, learnerId)
      .then((res) => { if (!cancelled) setEvents(res.events || []); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [learnerKind, learnerId]);

  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const toDate = useMemo(() => computeToDate(journey, real), [journey, real]);
  const aggregate = useMemo(() => quizAggregateStats(real), [real]);

  // Selectable months = every month with real activity, plus the current month.
  const monthKeys = useMemo(() => {
    const set = new Set<string>();
    for (const a of real?.quizAttempts || []) { const k = ymKey(a.submittedAt); if (k) set.add(k); }
    for (const v of real?.videoProgress || []) { const k = ymKey(v.submittedAt); if (k) set.add(k); }
    for (const c of real?.componentProgress || []) { const k = ymKey(c.submittedAt); if (k) set.add(k); }
    for (const f of real?.activityFeed || []) { const k = ymKey(f.at); if (k) set.add(k); }
    for (const e of events) { const k = ymKey(eventDate(e)); if (k) set.add(k); }
    const cur = ymKey(new Date().toISOString());
    if (cur) set.add(cur);
    return Array.from(set).sort();
  }, [real, events]);

  const currentKey = ymKey(new Date().toISOString())!;
  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = selected && monthKeys.includes(selected)
    ? selected
    : monthKeys.includes(currentKey) ? currentKey : monthKeys[monthKeys.length - 1] || currentKey;

  const month = useMemo(() => computeMonth(real, events, activeKey), [real, events, activeKey]);

  const completedHours = parseHours(real?.completedHours);
  const plannedHours = parseHours(real?.plannedHours) || real?.totalExpectedOtjh || 0;
  const otjhStatus = (real?.otjhStatus || '').trim();
  const otjhPill = otjhStatus.toLowerCase() === 'on track'
    ? { cls: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25', icon: 'ri-checkbox-circle-line' }
    : otjhStatus.toLowerCase() === 'at risk'
      ? { cls: 'bg-red-400/15 text-red-300 border-red-400/25', icon: 'ri-alarm-warning-line' }
      : { cls: 'bg-amber-400/15 text-amber-300 border-amber-400/25', icon: 'ri-error-warning-line' };

  // Next upcoming coaching/review from the whole calendar (not just this month).
  const nowIso = new Date().toISOString().slice(0, 10);
  const upcomingEvent = useMemo(() => {
    return events
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({ e, d: eventDate(e) }))
      .filter((x): x is { e: LearnerCalendarEvent; d: string } => Boolean(x.d) && x.d >= nowIso)
      .sort((a, b) => (a.d < b.d ? -1 : 1))[0]?.e || null;
  }, [events, nowIso]);

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const summaryItems = [
    { label: 'OTJH to date', value: `${formatHoursMinutes(completedHours)} / ${plannedHours}h`, icon: 'ri-time-line' },
    { label: 'Logged this month', value: month.loggedHours > 0 ? formatHoursMinutes(month.loggedHours) : '—', icon: 'ri-timer-line' },
    { label: 'Quizzes', value: month.quizzesTaken > 0 ? `${month.quizzesPassed}/${month.quizzesTaken} passed` : '—', icon: 'ri-questionnaire-line' },
    { label: 'Avg quiz score', value: month.avgGrade !== null ? `${month.avgGrade}%` : '—', icon: 'ri-bar-chart-2-line' },
    { label: 'Videos watched', value: month.videosWatched > 0 ? `${month.videosWatched}` : '—', icon: 'ri-play-circle-line' },
    { label: 'Activities done', value: month.componentsDone > 0 ? `${month.componentsDone}` : '—', icon: 'ri-checkbox-circle-line' },
    { label: 'Coaching / reviews', value: (month.coachingCount + month.reviewCount) > 0 ? `${month.coachingCount + month.reviewCount}` : '—', icon: 'ri-user-voice-line' },
    { label: 'KSBs evidenced', value: month.ksbCodes.length > 0 ? `${month.ksbCodes.length}` : '—', icon: 'ri-award-line' },
  ];

  const busy = loading || eventsLoading;

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Monthly Cycle"
      pageSubtitle={real ? `Your apprenticeship monthly rhythm — ${ymLabel(activeKey)}` : 'Your apprenticeship monthly rhythm'}
      userName={real?.name || 'Learner'} userRole={real?.programme ? `${real.programme} Apprentice` : 'Learner'}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {loadError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
            <i className="ri-error-warning-line text-red-500"></i>
            <p className="text-sm text-red-700">Could not load your monthly cycle: {loadError}</p>
          </div>
        )}

        {/* ═══════════ HERO ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>

          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[190px]">
            <div className="flex-1 px-5 md:px-8 py-6 md:py-7 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                {subtitle && <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md border border-accent-400/15">{subtitle}</span>}
                {otjhStatus && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${otjhPill.cls}`}>
                    <i className={otjhPill.icon}></i>OTJH {otjhStatus}
                  </span>
                )}
              </div>
              <h1 className="text-xl md:text-2xl font-heading font-bold text-white tracking-tight mb-1.5">Monthly Cycle</h1>
              <p className="text-sm text-white/45 max-w-xl mb-4">
                {ymLabel(activeKey)} · {month.quizzesTaken + month.videosWatched + month.componentsDone} {month.quizzesTaken + month.videosWatched + month.componentsDone === 1 ? 'activity' : 'activities'} this month
                {(month.coachingCount + month.reviewCount) > 0 && <> · {month.coachingCount + month.reviewCount} coaching/review</>}
              </p>

              {/* Month selector — real months only */}
              <div className="flex items-center gap-2 flex-wrap">
                {monthKeys.map((k) => {
                  const isActive = k === activeKey;
                  const isCurrent = k === currentKey;
                  return (
                    <button key={k} onClick={() => setSelected(k)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap border ${
                        isActive ? 'bg-white text-primary-800 border-white' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                      }`}>
                      {ymShort(k)}
                      {isCurrent && <span className={`ml-1.5 text-[8px] font-bold px-1 py-0.5 rounded-full ${isActive ? 'bg-primary-100 text-primary-700' : 'bg-accent-400/20 text-accent-200'}`}>Now</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:w-[260px] shrink-0 px-5 md:px-7 py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
              <Ring pct={toDate.overallPct} />
            </div>
          </div>
        </section>

        {busy && !loadError && (
          <div className="rounded-xl border border-background-300 bg-background-50 px-4 py-3 flex items-center gap-3">
            <i className="ri-loader-4-line animate-spin text-primary-500"></i>
            <p className="text-sm text-foreground-500">Loading your monthly progress…</p>
          </div>
        )}

        {/* ═══════════ MONTH SUMMARY ═══════════ */}
        <section className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center"><i className="ri-dashboard-line text-primary-600 text-sm"></i></span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">{ymLabel(activeKey)} — Summary</h3>
              <p className="text-xs text-foreground-400">Figures for the selected month; OTJH shown programme-to-date</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {summaryItems.map((item) => (
              <div key={item.label} className="p-2.5 rounded-lg border border-background-200/60 bg-background-50/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <i className={`${item.icon} text-foreground-400 text-[10px]`}></i>
                  <span className="text-[10px] font-medium text-foreground-500">{item.label}</span>
                </div>
                <p className="text-xs font-semibold text-foreground-800">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════ CURRENT FOCUS + NEXT BEST ACTION ═══════════ */}
        <section className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 flex flex-col sm:flex-row items-start gap-4">
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Current Focus</span>
            {toDate.nextComponent ? (
              <>
                <h3 className="text-base font-heading font-semibold text-foreground-900 mt-1.5">
                  {toDate.nextComponent.kind === 'quiz' ? 'Complete' : toDate.nextComponent.kind === 'video' ? 'Watch' : 'Open'}: {toDate.nextComponent.title}
                </h3>
                <p className="text-sm text-foreground-500 mt-1">
                  Next {toDate.nextComponent.kind === 'component' ? 'activity' : toDate.nextComponent.kind} in your training plan — {toDate.nextComponent.module}.
                  Completing it keeps your monthly progress on track.
                </p>
                <Link to="/learner/this-week" className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-focus-3-line text-sm"></i>Go to this week
                </Link>
              </>
            ) : (
              <>
                <h3 className="text-base font-heading font-semibold text-foreground-900 mt-1.5">All tracked activities complete</h3>
                <p className="text-sm text-foreground-500 mt-1">Every quiz and video in your plan is done. Speak to your coach about next steps.</p>
              </>
            )}
          </div>

          <div className="hidden sm:block w-px h-24 bg-background-200 self-stretch"></div>

          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Next Best Action</span>
            {upcomingEvent ? (
              <>
                <h3 className="text-base font-heading font-semibold text-foreground-900 mt-1.5">
                  {upcomingEvent.title}{upcomingEvent.sequence ? ` ${upcomingEvent.sequence}` : ''} on {formatDayMonth(eventDate(upcomingEvent)!)}
                </h3>
                <p className="text-sm text-foreground-500 mt-1">
                  {upcomingEvent.coachName ? `With ${upcomingEvent.coachName}. ` : ''}
                  Prepare your evidence and reflections before the session.
                </p>
                <div className="flex items-center gap-3 mt-3">
                  <Link to="/learner/calendar" className="inline-flex items-center gap-1.5 px-4 py-2 border border-foreground-300 text-foreground-700 rounded-lg text-sm font-semibold hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-calendar-line text-sm"></i>View calendar
                  </Link>
                  {upcomingEvent.meetingLink && (
                    <a href={upcomingEvent.meetingLink} target="_blank" rel="noreferrer" className="text-xs text-primary-600 font-semibold"><i className="ri-video-chat-line mr-1"></i>Join link</a>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-heading font-semibold text-foreground-900 mt-1.5">Book your next coaching session</h3>
                <p className="text-sm text-foreground-500 mt-1">No upcoming coaching or review is scheduled. Book one with your coach from the calendar.</p>
                <Link to="/learner/calendar" className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 border border-foreground-300 text-foreground-700 rounded-lg text-sm font-semibold hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-calendar-check-line text-sm"></i>Book a session
                </Link>
              </>
            )}
          </div>
        </section>

        {/* ═══════════ COACHING & REVIEWS THIS MONTH ═══════════ */}
        {month.events.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center"><i className="ri-user-voice-line text-primary-600 text-sm"></i></span>
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Coaching &amp; Reviews — {ymLabel(activeKey)}</h3>
                <p className="text-xs text-foreground-400">{month.events.length} session{month.events.length === 1 ? '' : 's'} from your coach timetable</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {month.events.map((e) => {
                const st = EVENT_STATUS_STYLE[e.status] || EVENT_STATUS_STYLE['not-scheduled'];
                const iso = eventDate(e);
                return (
                  <div key={e.id} className="bg-background-50 rounded-xl border border-background-200/60 p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-foreground-900">{e.title}{e.sequence ? ` ${e.sequence}` : ''}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}><i className={st.icon}></i>{st.label}</span>
                    </div>
                    <p className="text-xs text-foreground-500"><i className="ri-calendar-line mr-1 text-foreground-400"></i>{iso ? formatDayMonth(iso) : 'To be confirmed'}{e.scheduledTime ? ` · ${e.scheduledTime}` : ''}</p>
                    {e.coachName && <p className="text-xs text-foreground-500 mt-1"><i className="ri-user-line mr-1 text-foreground-400"></i>{e.coachName}</p>}
                    {e.meetingLink && (
                      <a href={e.meetingLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700"><i className="ri-video-chat-line"></i>Join meeting</a>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ═══════════ MONTH TIMELINE ═══════════ */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center"><i className="ri-time-line text-secondary-600 text-sm"></i></span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">{ymLabel(activeKey)} — Activity Timeline</h3>
              <p className="text-xs text-foreground-400">Everything you completed this month, newest first</p>
            </div>
          </div>
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
            {month.timeline.length === 0 ? (
              <EmptyState text={`No activity recorded in ${ymLabel(activeKey)} yet.`} />
            ) : (
              <div className="relative pl-6">
                <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-background-200" aria-hidden="true"></div>
                <div className="space-y-4">
                  {month.timeline.map((t, i) => {
                    const tone = TONE_STYLE[t.tone];
                    return (
                      <div key={i} className="relative">
                        <span className={`absolute -left-[22px] top-1 w-3.5 h-3.5 rounded-full border-2 border-background-50 ${tone.dot}`}></span>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground-900 flex items-center gap-1.5">
                              <i className={`${t.icon} text-foreground-400`}></i>{t.title}
                            </p>
                            {t.detail && <p className="text-xs text-foreground-500 mt-0.5">{t.detail}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {typeof t.passed === 'boolean' && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.passed ? 'Passed' : 'Not passed'}</span>
                            )}
                            {t.status && (EVENT_STATUS_STYLE[t.status]) && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${EVENT_STATUS_STYLE[t.status].cls}`}>{EVENT_STATUS_STYLE[t.status].label}</span>
                            )}
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tone.chip}`}>{t.dateLabel}</span>
                            {t.meetingLink && <a href={t.meetingLink} target="_blank" rel="noreferrer" className="text-xs text-primary-600"><i className="ri-video-chat-line"></i></a>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════ KSB PROGRESSION (to date) ═══════════ */}
        {real && <KsbSection real={real} evidencedCodes={aggregate.ksbCodes} />}

        {/* ═══════════ OTJH SNAPSHOT ═══════════ */}
        {real && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center"><i className="ri-time-line text-foreground-500 text-sm"></i></span>
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Off-the-Job Hours</h3>
                <p className="text-xs text-foreground-400">Your OTJH position across the programme</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <SnapshotTile label="Completed" value={`${formatHoursMinutes(completedHours)}`} icon="ri-check-double-line" iconBg="bg-emerald-100 text-emerald-600" />
              <SnapshotTile label="Planned" value={`${plannedHours}h`} icon="ri-flag-line" iconBg="bg-primary-100 text-primary-600" />
              <SnapshotTile label="Target to now" value={real.targetHours ? `${real.targetHours}h` : '—'} icon="ri-focus-3-line" iconBg="bg-secondary-100 text-secondary-600" />
              <SnapshotTile label="Variance" value={real.progressHours ? `${real.progressHours}h` : '—'} icon="ri-line-chart-line" iconBg="bg-amber-100 text-amber-600" />
              <SnapshotTile label="Status" value={otjhStatus || '—'} icon="ri-heart-pulse-line" iconBg="bg-primary-100 text-primary-600" />
            </div>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   KSB PROGRESSION — evidenced codes vs the programme's KSBs
   (mirrors RealLearningJourneyView.KsbSection)
   ═══════════════════════════════════════════════════════ */
function KsbSection({ real, evidencedCodes }: { real: LearnerDetail; evidencedCodes: string[] }) {
  const groups = useMemo(() => {
    const evidenced = new Set(evidencedCodes);
    const defs = [
      { key: 'K', label: 'Knowledge', icon: 'ri-book-open-line', chip: 'bg-primary-100 text-primary-600', bar: 'bg-primary-500', text: 'text-primary-600', blurb: 'Theory, frameworks and concepts' },
      { key: 'S', label: 'Skills', icon: 'ri-tools-line', chip: 'bg-amber-100 text-amber-600', bar: 'bg-amber-500', text: 'text-amber-600', blurb: 'Practical application at work' },
      { key: 'B', label: 'Behaviours', icon: 'ri-heart-line', chip: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', text: 'text-emerald-600', blurb: 'Professional conduct and mindset' },
    ];
    return defs.map((d) => {
      const items = (real.ksbs || []).filter((k) => ((k.type || k.code || '').trim().toUpperCase()[0] === d.key));
      const done = items.filter((k) => evidenced.has(k.code)).length;
      return { ...d, total: items.length, done, pct: items.length > 0 ? Math.round((done / items.length) * 100) : 0 };
    });
  }, [real, evidencedCodes]);

  if (groups.every((g) => g.total === 0)) return null;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center"><i className="ri-bar-chart-grouped-line text-secondary-600 text-sm"></i></span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB Progression</h3>
          <p className="text-xs text-foreground-400">{groups.reduce((n, g) => n + g.done, 0)} of {groups.reduce((n, g) => n + g.total, 0)} KSBs evidenced through your activities</p>
        </div>
      </div>
      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${g.chip}`}><i className={`${g.icon} text-xs`}></i></span>
                  <span className="text-sm font-semibold text-foreground-900">{g.label}</span>
                </div>
                <span className={`text-sm font-bold ${g.text}`}>{g.total > 0 ? `${g.done}/${g.total}` : '—'}</span>
              </div>
              <div className="h-2.5 bg-background-200 rounded-full overflow-hidden">
                <div className={`h-full ${g.bar} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${g.pct}%` }} />
              </div>
              <p className="text-xs text-foreground-400 mt-1.5">{g.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SnapshotTile({ label, value, icon, iconBg }: { label: string; value: string; icon: string; iconBg: string }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 text-center hover:scale-[1.03] hover:shadow-md transition-all duration-200">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-2 ${iconBg}`}><i className={icon}></i></span>
      <p className="text-base font-heading font-bold text-foreground-900 leading-tight">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}
