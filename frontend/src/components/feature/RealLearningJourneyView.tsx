import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { buildLearnerJourney, quizAggregateStats, parseHours, formatHoursMinutes, isOpenableComponent, type JourneyModule } from '@/utils/learnerJourney';

const learnerNav = roleNavMap.learner;

/* ═══════════════════════════════════════════════════════
   REAL-DATA DERIVATION
   A component is "trackable" when the platform can observe
   completion: quizzes (attempts) and videos (watch records).
   ═══════════════════════════════════════════════════════ */
export type StationStatus = 'completed' | 'current' | 'upcoming';

interface WeekDot { week: string; total: number; done: number }

export interface ModuleStation {
  module: JourneyModule;
  index: number;
  trackableTotal: number;
  trackableDone: number;
  pct: number | null; // null when nothing trackable
  quizTotal: number;
  quizTaken: number;
  quizPassed: number;
  videoTotal: number;
  videoDone: number;
  componentCount: number;
  otjhPlanned: number;
  weekDots: WeekDot[];
  status: StationStatus;
}

interface JourneyMetricData {
  icon: string;
  label: string;
  value: string;
  detail: string;
  description: string;
  progress: number;
  rows: Array<{ label: string; value: string }>;
}

function isVideoComponent(c: JourneyModule['weeks'][number]['components'][number]): boolean {
  return Boolean(c.videoUrl) || (c.type || '').toLowerCase() === 'video';
}

/** Week labels are free text ("Week1 Name will be here ==> …") — extract a
 * readable display label ("Week 1"), truncating otherwise. */
function weekDisplayLabel(week: string): string {
  const m = week.match(/week\s*-?\s*(\d+)/i);
  if (m) return `Week ${m[1]}`;
  const t = week.trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
}

export function buildStations(journey: JourneyModule[], real: LearnerDetail | null): { stations: ModuleStation[]; overallPct: number; currentIndex: number; currentWeek: string | null } {
  const watched = new Set((real?.videoProgress || []).map((v) => v.componentId));
  // Generic (podcast/reading/slides/reflection/…) completions count as done too.
  const completedComponents = new Set((real?.componentProgress || []).map((c) => c.componentId));

  const raw = journey.map((mod, index) => {
    let trackableTotal = 0, trackableDone = 0, quizTotal = 0, quizTaken = 0, quizPassed = 0, videoTotal = 0, videoDone = 0, componentCount = 0, otjhPlanned = 0;
    const weekDots: WeekDot[] = [];
    for (const w of mod.weeks) {
      let wTotal = 0, wDone = 0;
      for (const c of w.components) {
        componentCount += 1;
        otjhPlanned += c.expectedOtjh || 0;
        if (c.isQuiz) {
          quizTotal += 1; trackableTotal += 1; wTotal += 1;
          const attempts = c.quizAttempts || [];
          if (attempts.length > 0) { quizTaken += 1; trackableDone += 1; wDone += 1; }
          if (attempts.some((a) => a.passed)) quizPassed += 1;
        } else if (isVideoComponent(c)) {
          videoTotal += 1; trackableTotal += 1; wTotal += 1;
          if (c.componentId && watched.has(c.componentId)) { videoDone += 1; trackableDone += 1; wDone += 1; }
        } else if (isOpenableComponent(c)) {
          // Generic completable content (podcast/reading/slides/reflection/…).
          trackableTotal += 1; wTotal += 1;
          if (c.componentId && completedComponents.has(c.componentId)) { trackableDone += 1; wDone += 1; }
        }
      }
      weekDots.push({ week: w.week, total: wTotal, done: wDone });
    }
    const pct = trackableTotal > 0 ? Math.round((trackableDone / trackableTotal) * 100) : null;
    return { module: mod, index, trackableTotal, trackableDone, pct, quizTotal, quizTaken, quizPassed, videoTotal, videoDone, componentCount, otjhPlanned, weekDots };
  });

  const anyTrackable = raw.some((m) => m.trackableTotal > 0);
  let currentIndex = raw.findIndex((m) => m.trackableTotal > 0 && m.trackableDone < m.trackableTotal);
  if (currentIndex === -1) currentIndex = anyTrackable ? -1 : 0; // -1 → everything done

  const stations: ModuleStation[] = raw.map((m) => ({
    ...m,
    status: currentIndex === -1 ? 'completed' : m.index < currentIndex ? 'completed' : m.index === currentIndex ? 'current' : 'upcoming',
  }));

  const totalTrackable = raw.reduce((n, m) => n + m.trackableTotal, 0);
  const totalDone = raw.reduce((n, m) => n + m.trackableDone, 0);
  const overallPct = totalTrackable > 0 ? Math.round((totalDone / totalTrackable) * 100) : 0;

  let currentWeek: string | null = null;
  if (currentIndex >= 0 && stations[currentIndex]) {
    const dot = stations[currentIndex].weekDots.find((w) => w.total > 0 && w.done < w.total) || stations[currentIndex].weekDots[0];
    currentWeek = dot?.week ?? null;
  }
  return { stations, overallPct, currentIndex, currentWeek };
}

/* ═══════════════════════════════════════════════════════
   MOTION PRIMITIVES (no animation deps — rAF + IO + CSS)
   ═══════════════════════════════════════════════════════ */

/** Ease-out numeric count-up. Arms when visible (with a safety-net timer) and
 * re-animates from the current figure whenever `value` changes — the data often
 * arrives AFTER mount, so a one-shot animation would stay frozen at 0. */
function CountUp({ value, decimals = 0, suffix = '', className = '' }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [armed, setArmed] = useState(false);
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setArmed(true); obs.disconnect(); }
    }, { threshold: 0.3 });
    obs.observe(el);
    const fallback = setTimeout(() => setArmed(true), 900);
    return () => { obs.disconnect(); clearTimeout(fallback); };
  }, []);

  useEffect(() => {
    if (!armed) return;
    const from = displayRef.current;
    if (from === value) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = 1000;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (value - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [armed, value]);

  return <span ref={ref} className={className}>{display.toFixed(decimals)}{suffix}</span>;
}

/** Scroll-reveal wrapper: fades + slides in when it enters the viewport. */
function Reveal({ children, from = 'up', delay = 0, className = '' }: { children: React.ReactNode; from?: 'up' | 'left' | 'right'; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); }
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    obs.observe(el);
    // Safety net: never leave content hidden if the observer misfires.
    const fallback = setTimeout(() => setVisible(true), 1200 + delay);
    return () => { obs.disconnect(); clearTimeout(fallback); };
  }, [delay]);

  const hidden = from === 'left' ? '-translate-x-6 opacity-0' : from === 'right' ? 'translate-x-6 opacity-0' : 'translate-y-6 opacity-0';
  return (
    <div ref={ref} className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${visible ? 'translate-x-0 translate-y-0 opacity-100' : hidden} ${className}`}>
      {children}
    </div>
  );
}

/** Animated hero donut — draws itself when the value lands. */
function HeroDonut({ pct }: { pct: number }) {
  const size = 148, stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="stroke-accent-400" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.22,1,0.36,1)', filter: 'drop-shadow(0 0 10px oklch(var(--accent-400) / 0.45))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-heading font-bold text-white leading-none"><CountUp value={pct} suffix="%" /></span>
        <span className="text-[10px] text-white/50 uppercase tracking-wider mt-1.5 font-semibold">Journey</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CHECKPOINT VISUAL SYSTEM (status = colour + icon + label,
   never colour alone)
   ═══════════════════════════════════════════════════════ */
const CHECKPOINT_STYLE: Record<StationStatus, {
  ringStroke: string; iconWrap: string; icon: string; badge: string; badgeIcon: string; badgeLabel: string; bar: string; card: string;
}> = {
  completed: {
    ringStroke: 'stroke-emerald-500',
    iconWrap: 'bg-emerald-500 text-white shadow-[0_0_16px_-2px_rgba(16,185,129,0.6)]',
    icon: 'ri-check-line',
    badge: 'bg-emerald-100 text-emerald-700',
    badgeIcon: 'ri-checkbox-circle-fill',
    badgeLabel: 'Completed',
    bar: 'bg-emerald-500',
    card: 'border-emerald-200/80',
  },
  current: {
    ringStroke: 'stroke-primary-500',
    iconWrap: 'bg-primary-500 text-white shadow-[0_0_18px_-2px_oklch(var(--primary-500)/0.7)]',
    icon: 'ri-flag-2-fill',
    badge: 'bg-primary-100 text-primary-700',
    badgeIcon: 'ri-focus-2-line',
    badgeLabel: 'In Progress',
    bar: 'bg-primary-500',
    card: 'border-primary-200 ring-1 ring-primary-200/60 shadow-lg shadow-primary-500/5',
  },
  upcoming: {
    ringStroke: 'stroke-background-300',
    iconWrap: 'bg-background-100 text-foreground-400 border-2 border-dashed border-background-300',
    icon: 'ri-lock-2-line',
    badge: 'bg-background-100 text-foreground-500',
    badgeIcon: 'ri-time-line',
    badgeLabel: 'Upcoming',
    bar: 'bg-foreground-300',
    card: 'border-foreground-200/60 border-dashed',
  },
};

/** Circular checkpoint ring showing the module's own completion. */
function CheckpointRing({ station }: { station: ModuleStation }) {
  const s = CHECKPOINT_STYLE[station.status];
  const size = 96, stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = station.status === 'completed' ? 100 : (station.pct ?? 0);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 250); return () => clearTimeout(t); }, []);
  const offset = circ - (Math.min(drawn ? pct : 0, 100) / 100) * circ;

  return (
    <div className="relative shrink-0 transition-transform duration-300 hover:scale-105" style={{ width: size, height: size }}>
      {station.status === 'current' && (
        <span className="absolute inset-[-10px] rounded-full bg-primary-400/20 animate-ping" style={{ animationDuration: '2.4s' }} />
      )}
      <div className="absolute inset-2 rounded-full bg-background-50 shadow-sm" />
      <svg width={size} height={size} className="-rotate-90 relative">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-background-200" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={s.ringStroke} strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`w-10 h-10 rounded-full flex items-center justify-center ${s.iconWrap}`}>
          <i className={`${s.icon} text-lg`}></i>
        </span>
        <span className="text-[10px] font-bold text-foreground-500 mt-1 leading-none">
          {station.status === 'completed' ? '100%' : station.pct !== null ? `${station.pct}%` : `M${station.index + 1}`}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   THE WINDING ROAD — a horizontal serpentine journey (the
   Thumbtack "Pro Journey" shape). Stops are laid out in
   boustrophedon rows (row 1 →, row 2 ←, row 3 →…); a single
   SVG road threads through every stop centre, its gold fill
   growing to your REAL progression. Below `md` it gracefully
   degrades to a clean vertical rail (RoadStack) — a curved
   road can't stay legible in a phone's width.
   ═══════════════════════════════════════════════════════ */

function QuestTrail({ stations, done, learnerName, travelled, real }: { stations: ModuleStation[]; done: boolean; learnerName: string; travelled: number; real: LearnerDetail }) {
  return (
    <>
      {/* Desktop / tablet: clean horizontal roadmap */}
      <div className="hidden md:block">
        <HorizontalRoadmap stations={stations} done={done} travelled={travelled} real={real} />
      </div>
      {/* Mobile: vertical rail fallback */}
      <div className="md:hidden">
        <RoadStack stations={stations} done={done} learnerName={learnerName} travelled={travelled} />
      </div>
    </>
  );
}

function HorizontalRoadmap({ stations, done, travelled, real }: { stations: ModuleStation[]; done: boolean; travelled: number; real: LearnerDetail }) {
  const [selectedStation, setSelectedStation] = useState<ModuleStation | null>(null);

  useEffect(() => {
    const requestedModule = Number(new URLSearchParams(window.location.search).get('module'));
    if (!Number.isInteger(requestedModule) || requestedModule < 1) return;
    const requestedStation = stations.find((station) => station.index === requestedModule - 1);
    if (requestedStation) setSelectedStation(requestedStation);
  }, [stations]);

  const openStation = (station: ModuleStation) => {
    setSelectedStation(station);
    const url = new URL(window.location.href);
    url.searchParams.set('module', String(station.index + 1));
    window.history.replaceState(window.history.state, '', url);
  };

  const closeStation = () => {
    setSelectedStation(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('module');
    window.history.replaceState(window.history.state, '', url);
  };

  const items = [
    { key: 'enrolment', label: 'Enrolment', status: 'completed' as StationStatus, icon: 'ri-check-line', station: undefined },
    ...stations.map((station) => ({
      key: `module-${station.index}`,
      label: `Module ${station.index + 1}`,
      status: station.status,
      icon: station.status === 'completed' ? 'ri-check-line' : station.status === 'current' ? 'ri-play-fill' : 'ri-more-line',
      station,
    })),
    { key: 'epa', label: 'EPA Preparation', status: 'upcoming' as StationStatus, icon: 'ri-lock-2-line', station: undefined },
    { key: 'gateway', label: 'Gateway Review', status: done ? 'completed' as StationStatus : 'upcoming' as StationStatus, icon: done ? 'ri-check-line' : 'ri-lock-2-line', station: undefined },
    { key: 'graduation', label: 'Graduation', status: 'upcoming' as StationStatus, icon: 'ri-graduation-cap-line', station: undefined },
  ];

  return (
    <>
      <div className="w-full overflow-x-auto px-3 pb-5 pt-7">
        <div className="relative flex w-full min-w-[1120px] items-start px-5">
          <div className="absolute left-[62px] right-[62px] top-10 h-2 rounded-full bg-background-200 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-primary-400 to-primary-600 shadow-[0_0_12px_rgba(124,92,255,0.28)] transition-all duration-1000"
              style={{ width: `${Math.max(3, Math.round(travelled * 100))}%` }}
            />
          </div>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={!item.station}
              onClick={() => item.station && openStation(item.station)}
              className={`relative z-10 flex min-w-[130px] flex-1 flex-col items-center ${item.station ? 'group cursor-pointer' : 'cursor-default'}`}
            >
              {item.status === 'current' && (
                <>
                  <span className="absolute top-0 h-20 w-20 animate-ping rounded-full bg-primary-400/20" style={{ animationDuration: '2.4s' }} />
                  <span className="absolute -top-5 rounded-full bg-primary-600 px-2.5 py-1 text-[8px] font-bold uppercase tracking-widest text-white shadow-lg">Current</span>
                </>
              )}
              <span className={`relative flex h-20 w-20 items-center justify-center rounded-full border-[6px] text-2xl shadow-md transition-all duration-300 ${
                item.status === 'completed'
                  ? 'border-emerald-100 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-500/20'
                  : item.status === 'current'
                    ? 'border-primary-200 bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-xl shadow-primary-500/35'
                    : 'border-background-100 bg-background-50 text-foreground-500 ring-2 ring-inset ring-foreground-200'
              } ${item.station ? 'group-hover:-translate-y-1 group-hover:scale-110 group-hover:shadow-2xl' : ''}`}>
                <i className={item.icon} />
              </span>
              <span className={`mt-3 rounded-full px-3 py-1.5 text-center text-xs font-bold leading-tight ${
                item.status === 'current'
                  ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200'
                  : item.status === 'completed'
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                    : 'bg-background-100 text-foreground-500 ring-1 ring-foreground-100'
              }`}>{item.label}</span>
              {item.station && (
                <span className={`mt-2 text-[10px] font-semibold ${item.status === 'current' ? 'text-primary-600' : 'text-foreground-400'}`}>
                  {item.station.pct ?? 0}% · Click to view
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedStation && (
        <ModuleActivityModal station={selectedStation} real={real} onClose={closeStation} />
      )}
    </>
  );
}

function ModuleActivityModal({ station, real, onClose }: { station: ModuleStation; real: LearnerDetail; onClose: () => void }) {
  const completedActivities = station.module.weeks
    .flatMap((week) => week.components.map((component) => ({ component, week: week.week })))
    .filter(({ component }) => isJourneyComponentDone(component, real));
  const moduleComponents = station.module.weeks.flatMap((week) => week.components);
  const componentIds = new Set(moduleComponents.map((component) => component.componentId).filter(Boolean));
  const quizIds = new Set(moduleComponents.filter((component) => component.isQuiz).map((component) => component.quizMeta?.quizId).filter((id): id is number => id != null));
  const moduleName = station.module.module.trim().toLowerCase();
  const activityRecords = (real.activityFeed || []).filter((entry) => {
    const entryModule = (entry.module || '').trim().toLowerCase();
    return (entryModule && (entryModule === moduleName || entryModule.includes(moduleName) || moduleName.includes(entryModule)))
      || Boolean(entry.componentId && componentIds.has(entry.componentId))
      || Boolean(entry.quizId != null && quizIds.has(entry.quizId));
  });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-primary-950/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-activity-title"
        className="relative max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-white/70 bg-background-50 shadow-[0_30px_100px_rgba(20,8,45,0.35)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 px-6 py-6 text-white">
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20">
            <i className="ri-close-line text-lg" />
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/80">
            <i className="ri-book-open-line" />Module {station.index + 1}
          </span>
          <h2 id="module-activity-title" className="mt-3 pr-10 text-xl font-heading font-bold !text-white">{station.module.module}</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs !text-white">
            <span><i className="ri-checkbox-circle-line mr-1.5" />{completedActivities.length} activities completed</span>
            <span><i className="ri-history-line mr-1.5" />{activityRecords.length} recorded actions</span>
            <span><i className="ri-stack-line mr-1.5" />{station.componentCount} total activities</span>
            <span><i className="ri-bar-chart-line mr-1.5" />{station.pct ?? 0}% progress</span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-white" style={{ width: `${station.pct ?? 0}%` }} />
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-heading font-bold text-foreground-900">Full activity history</h3>
              <p className="mt-0.5 text-xs text-foreground-400">Every recorded action by the learner in this module</p>
            </div>
            <span className="rounded-full bg-primary-100 px-2.5 py-1 text-[10px] font-semibold text-primary-700">{activityRecords.length} records</span>
          </div>

          {activityRecords.length > 0 ? (
            <div className="space-y-3">
              {activityRecords.map((entry, index) => {
                const meta = componentTypeVisual(entry.kind === 'component' ? entry.componentType || 'activity' : entry.kind);
                const completed = entry.passed !== false;
                return (
                  <div key={`${entry.at}-${entry.componentId || entry.quizId || index}`} className="group flex items-center gap-3 rounded-2xl border border-foreground-100 bg-background-50 p-3.5 transition hover:border-primary-200 hover:bg-primary-50/20 hover:shadow-sm">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${meta.cls}`}><i className={`${meta.icon} text-lg`} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground-900">{entry.title || entry.action}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${completed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{completed ? 'Completed' : 'Attempted'}</span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-foreground-400">{entry.detail || entry.action}</p>
                      <p className="mt-1 text-[10px] text-foreground-400">
                        <i className="ri-calendar-line mr-1" />{new Date(entry.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {entry.week ? ` · ${weekDisplayLabel(entry.week)}` : ''}
                      </p>
                    </div>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${completed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}><i className={completed ? 'ri-check-line' : 'ri-time-line'} /></span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-100/50 px-6 py-12 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background-100 text-foreground-400"><i className="ri-inbox-line text-xl" /></span>
              <p className="mt-3 text-sm font-semibold text-foreground-700">No recorded activity yet</p>
              <p className="mt-1 text-xs text-foreground-400">The learner’s actions will appear here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Serpentine geometry ─────────────────────────────────
   We place N "stops" (start · each module · summit) on a
   grid of `cols` columns, snaking direction each row. Each
   stop owns a cell; the SVG road is a smooth path through
   the ordered cell centres, with rounded U-turns at row
   ends. Percentages (not pixels) keep it fluid at any width.
   ──────────────────────────────────────────────────────── */

/** Choose a column count that keeps rows balanced (no lonely near-empty final
 * row) and the road pleasantly wide for short journeys. */
function roadColumns(totalStops: number): number {
  if (totalStops <= 3) return Math.max(2, totalStops);
  if (totalStops <= 4) return 2;   // e.g. start+2 modules+gateway → two rows of 2
  if (totalStops <= 6) return 3;   // up to 4 modules → tidy 3-wide rows
  return 4;                        // 5+ modules → 4-wide serpentine
}

interface RoadStop {
  kind: 'start' | 'module' | 'summit';
  station?: ModuleStation;
  col: number;      // 0..COLS-1, already reflected for the row's direction
  row: number;
  cx: number;       // cell-centre X in %  (of the road board)
  cy: number;       // cell-centre Y in px
}

/** Cubic-smooth path string through the ordered stop centres, in PIXELS (square
 * units, so getTotalLength maps 1:1 to what's drawn). Straight runs along a row,
 * a soft vertical S at each row change — mirrors the reference's looping ribbon.
 * `edge` bulges the U-turns just past the turn column for a rounded loop. */
function buildRoadPath(stops: RoadStop[], boardW: number): string {
  if (stops.length === 0) return '';
  const P = stops.map((s) => ({ x: (s.cx / 100) * boardW, y: s.cy }));
  let d = `M ${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if (Math.abs(a.y - b.y) < 1) {
      d += ` L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;          // same row → straight
    } else {
      const midY = (a.y + b.y) / 2;                            // row change → soft U
      d += ` C ${a.x.toFixed(1)} ${midY.toFixed(1)} ${b.x.toFixed(1)} ${midY.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
  }
  return d;
}

function WindingRoad({ stations, done, travelled }: { stations: ModuleStation[]; done: boolean; learnerName: string; travelled: number }) {
  // Ordered stops: start → modules → summit.
  const ordered: Array<{ kind: RoadStop['kind']; station?: ModuleStation }> = [
    { kind: 'start' },
    ...stations.map((st) => ({ kind: 'module' as const, station: st })),
    { kind: 'summit' as const },
  ];

  const cols = roadColumns(ordered.length);

  // Row band = road lane + a card-well above and below it. Cards float into the
  // well on their row's "outside", so adjacent rows never fight for the gap. The
  // well must clear a full card (~header + 2-line title + meter + stat row).
  const laneH = 104;                       // px of road-lane height per row
  const wellH = 196;                       // px reserved for a floating card
  const rowH = laneH + wellH;              // full band height
  const rows = Math.ceil(ordered.length / cols);
  const boardH = rows * rowH;
  // Lane centre for a row: even rows hug the lower part of their band (card wells
  // above), odd rows hug the upper part (card wells below) — outward alternation.
  const laneCentreY = (row: number) => row % 2 === 0
    ? row * rowH + wellH + laneH / 2
    : row * rowH + laneH / 2;

  // Count how many stops land in each row, so a partial last row can spread its
  // members evenly across the FULL width instead of clustering to one side.
  const perRow: number[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const r = Math.floor(i / cols);
    perRow[r] = (perRow[r] || 0) + 1;
  }
  // Even horizontal spread within a row: N stops sit at their slot centres of an
  // N-slot division (1 stop → centred; 2 → 1/4 & 3/4; 3 → 1/6, 3/6, 5/6). Applied
  // per row, every neighbour pair in a row is the same distance apart, and a short
  // final row stays balanced. Rows connect with a diagonal S (see buildRoadPath).
  const spreadX = (posInRow: number, count: number) => ((posInRow + 0.5) / count) * 100;

  const stops: RoadStop[] = ordered.map((o, i) => {
    const row = Math.floor(i / cols);
    const posInRow = i % cols;
    const count = perRow[row];
    const leftToRight = row % 2 === 0;
    const slot = leftToRight ? posInRow : count - 1 - posInRow;   // reflect on R→L rows
    return { ...o, col: slot, row, cx: spreadX(slot, count), cy: laneCentreY(row) };
  });

  // Measure the board's real pixel width so the SVG uses square units — this keeps
  // the road un-stretched AND makes getTotalLength() exact, so the gold fill stops
  // at the right point instead of covering the whole path.
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardW, setBoardW] = useState(0);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setBoardW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pathD = boardW > 0 ? buildRoadPath(stops, boardW) : '';

  // Draw-on animation for the gold fill. We normalise the path to pathLength=1 so
  // the dash maths is unit-free (no getTotalLength timing race): dasharray "1 1"
  // makes one full-length "on" dash, and dashoffset (1-travelled) slides all but
  // the travelled head off the start. Starts at offset 1 (hidden), then paves in.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!pathD) return;
    const t = setTimeout(() => setArmed(true), 250);
    return () => clearTimeout(t);
  }, [pathD]);
  const dashOffset = 1 - (armed ? travelled : 0);

  return (
    <div ref={boardRef} className="relative mx-auto" style={{ height: boardH, maxWidth: 980 }}>
      {/* the road itself — square-unit viewBox (px), no stretch */}
      {boardW > 0 && (
        <svg className="absolute inset-0 pointer-events-none" width={boardW} height={boardH} viewBox={`0 0 ${boardW} ${boardH}`} aria-hidden="true">
          <defs>
            <linearGradient id="road-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="55%" stopColor="oklch(var(--primary-500))" />
              <stop offset="100%" stopColor="oklch(var(--accent-500))" />
            </linearGradient>
          </defs>
          {/* base (untravelled) road */}
          <path d={pathD} fill="none" stroke="oklch(var(--background-200))" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
          {/* dashed centre markings on the base */}
          <path d={pathD} fill="none" stroke="oklch(var(--background-50) / 0.9)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="1 22" />
          {/* travelled (gold) road, paving on — pathLength-normalised reveal */}
          <path d={pathD} fill="none" stroke="url(#road-fill)" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round"
            pathLength={1} strokeDasharray="1 1" strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 1.8s cubic-bezier(0.22,1,0.36,1)', filter: 'drop-shadow(0 1px 3px oklch(var(--primary-500) / 0.25))' }} />
        </svg>
      )}

      {/* stops positioned over the road */}
      {stops.map((stop, i) => (
        <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${stop.cx}%`, top: stop.cy }}>
          {stop.kind === 'start' && <RoadStart />}
          {stop.kind === 'summit' && <RoadSummitNode done={done} />}
          {stop.kind === 'module' && stop.station && <RoadCheckpoint station={stop.station} placeAbove={stop.row % 2 === 0} />}
        </div>
      ))}
    </div>
  );
}

/** Start pin on the road. */
function RoadStart() {
  return (
    <Reveal>
      <div className="flex flex-col items-center">
        <span className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-white flex items-center justify-center shadow-md ring-4 ring-background-50">
          <i className="ri-flag-2-fill text-lg"></i>
        </span>
        <span className="mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 whitespace-nowrap">Start</span>
      </div>
    </Reveal>
  );
}

/** Summit node on the road. Reuses the Summit crest + copy, laid out compactly. */
function RoadSummitNode({ done }: { done: boolean }) {
  return (
    <Reveal>
      <div className="flex flex-col items-center">
        <div className="relative">
          {done && <span className="absolute inset-[-10px] rounded-full bg-amber-300/30 animate-ping" style={{ animationDuration: '2.4s' }} />}
          <div className={`relative w-[74px] h-[74px] rounded-full flex flex-col items-center justify-center ring-[6px] transition-transform duration-300 hover:scale-105 ${
            done
              ? 'bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-white ring-amber-100 shadow-[0_0_30px_-4px_rgba(245,158,11,0.65)]'
              : 'bg-background-50 text-foreground-400 ring-background-100 border-2 border-dashed border-background-300'
          }`}>
            <i className="ri-trophy-fill text-2xl leading-none"></i>
          </div>
        </div>
        <span className={`mt-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${done ? 'text-amber-600' : 'text-foreground-400'}`}>Gateway</span>
      </div>
    </Reveal>
  );
}

/** A module checkpoint on the road: the completion ring sits on the tarmac, its
 * module card floats above or below to avoid colliding with the next row. */
function RoadCheckpoint({ station, placeAbove }: { station: ModuleStation; placeAbove: boolean }) {
  return (
    <div className="relative flex flex-col items-center">
      {/* card, floated off the road */}
      <div className={`absolute left-1/2 -translate-x-1/2 w-[236px] lg:w-[260px] ${placeAbove ? 'bottom-full mb-3' : 'top-full mt-3'}`}>
        <Reveal from="up" delay={60}>
          <RoadCard station={station} />
        </Reveal>
      </div>

      {/* the checkpoint ring on the road */}
      <Reveal>
        <div className="relative flex flex-col items-center">
          {station.status === 'current' && (
            <span className="absolute -top-7 whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-white bg-primary-500 px-2 py-0.5 rounded-full shadow-lg animate-bounce z-10" style={{ animationDuration: '1.8s' }}>
              You are here
            </span>
          )}
          <div className="scale-[0.82] lg:scale-90">
            <CheckpointRing station={station} />
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** Compact module card used along the road (both orientations). */
function RoadCard({ station }: { station: ModuleStation }) {
  const s = CHECKPOINT_STYLE[station.status];
  return (
    <div className={`bg-background-50 rounded-2xl border p-3.5 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 ${s.card} ${station.status === 'upcoming' ? 'opacity-90' : 'shadow-md'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-foreground-400 leading-tight">
          Module {station.index + 1} · {station.module.weeks.length}{station.module.weeks.length === 1 ? ' week' : ' weeks'}
        </p>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${s.badge}`}>
          <i className={s.badgeIcon}></i>{s.badgeLabel}
        </span>
      </div>
      <h3 className="text-sm font-heading font-bold text-foreground-900 leading-snug mb-2.5 line-clamp-2">{station.module.module}</h3>

      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex-1 h-2 rounded-full bg-background-200 overflow-hidden">
          <div className={`h-full rounded-full ${s.bar} transition-all duration-1000 ease-out`} style={{ width: `${station.status === 'completed' ? 100 : station.pct ?? 0}%` }} />
        </div>
        <span className="text-xs font-bold text-foreground-800 w-9 text-right">{station.pct === null ? '—' : `${station.status === 'completed' ? 100 : station.pct}%`}</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <RoadStat icon="ri-stack-line" value={station.trackableTotal > 0 ? `${station.trackableDone}/${station.trackableTotal}` : `${station.componentCount}`} label="Components" />
        <RoadStat icon="ri-questionnaire-line" value={station.quizTotal > 0 ? `${station.quizTaken}/${station.quizTotal}` : '—'} label="Quizzes" />
        <RoadStat icon="ri-play-circle-line" value={station.videoTotal > 0 ? `${station.videoDone}/${station.videoTotal}` : '—'} label="Videos" />
      </div>
    </div>
  );
}

function RoadStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="rounded-lg bg-background-100/70 border border-background-200 px-1 py-1 text-center">
      <p className="text-xs font-heading font-bold text-foreground-900 leading-tight"><i className={`${icon} text-foreground-400 text-[10px] mr-0.5`}></i>{value}</p>
      <p className="text-[8px] text-foreground-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}

/* ── Mobile fallback: vertical rail (the previous trail, trimmed) ── */
function RoadStack({ stations, done, learnerName, travelled }: { stations: ModuleStation[]; done: boolean; learnerName: string; travelled: number }) {
  return (
    <div className="relative max-w-[560px] mx-auto pb-2">
      <div className="absolute left-6 top-4 bottom-10 w-2 rounded-full bg-background-200 overflow-hidden" aria-hidden="true">
        <div className="w-full rounded-full bg-gradient-to-b from-emerald-400 via-primary-500 to-accent-500"
          style={{ height: `${travelled * 100}%`, transition: 'height 1.6s cubic-bezier(0.22,1,0.36,1)' }} />
      </div>

      <div className="relative flex flex-col gap-6">
        <Reveal>
          <div className="flex items-center gap-3 pl-1">
            <span className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-white flex items-center justify-center shadow-md ring-4 ring-background-50">
              <i className="ri-flag-2-fill text-lg"></i>
            </span>
            <span className="text-xs font-bold text-emerald-600">{learnerName ? `${learnerName.split(' ')[0]}'s journey begins` : 'Your journey begins'}</span>
          </div>
        </Reveal>

        {stations.map((st) => (
          <div key={st.index} className="relative flex items-start gap-3">
            <Reveal>
              <div className="relative shrink-0">
                {st.status === 'current' && (
                  <span className="absolute -top-6 left-0 whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-white bg-primary-500 px-2 py-0.5 rounded-full shadow-lg animate-bounce z-10" style={{ animationDuration: '1.8s' }}>
                    You are here
                  </span>
                )}
                <div className="scale-[0.78] origin-left">
                  <CheckpointRing station={st} />
                </div>
              </div>
            </Reveal>
            <Reveal from="left" delay={60} className="flex-1 min-w-0 pt-1">
              <RoadCard station={st} />
            </Reveal>
          </div>
        ))}

        <div className="flex items-center gap-3 pl-1">
          <Reveal>
            <RoadSummitNode done={done} />
          </Reveal>
          <Reveal delay={80} className="flex-1">
            <p className="text-xs text-foreground-400 leading-relaxed">
              {done ? 'Every tracked activity is complete — brilliant work. Speak to your coach about Gateway.' : 'The summit: portfolio complete, KSBs evidenced, ready for your End Point Assessment.'}
            </p>
          </Reveal>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   KSB PROGRESSION — evidenced codes vs the programme's KSBs
   ═══════════════════════════════════════════════════════ */
function KsbSection({ real, evidencedCodes }: { real: LearnerDetail; evidencedCodes: string[] }) {
  const groups = useMemo(() => {
    const evidenced = new Set(evidencedCodes.map((code) => code.trim().toUpperCase()));
    const defs = [
      { key: 'K', label: 'Knowledge', icon: 'ri-book-open-line', chip: 'bg-primary-100 text-primary-600', bar: 'bg-primary-500', text: 'text-primary-600', blurb: 'Theory, frameworks and concepts' },
      { key: 'S', label: 'Skills', icon: 'ri-tools-line', chip: 'bg-amber-100 text-amber-600', bar: 'bg-amber-500', text: 'text-amber-600', blurb: 'Practical application at work' },
      { key: 'B', label: 'Behaviours', icon: 'ri-heart-line', chip: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', text: 'text-emerald-600', blurb: 'Professional conduct and mindset' },
    ];
    return defs.map((d) => {
      // KSB type arrives as a single letter ("K"/"S"/"B"); fall back to the code's first letter.
      const items = (real.ksbs || []).filter((k) => ((k.type || k.code || '').trim().toUpperCase()[0] === d.key));
      const done = items.filter((k) => evidenced.has(k.code.trim().toUpperCase())).length;
      return { ...d, total: items.length, done, pct: items.length > 0 ? Math.round((done / items.length) * 100) : 0 };
    });
  }, [real, evidencedCodes]);

  if (groups.every((g) => g.total === 0)) return null;

  return (
    <Reveal>
      <section className="rounded-3xl border border-foreground-100 bg-gradient-to-br from-background-50 via-background-50 to-primary-50/20 p-5 shadow-[0_12px_40px_rgba(31,19,57,0.05)] md:p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary-100 text-secondary-600"><i className="ri-bar-chart-grouped-line text-base"></i></span>
          <div>
            <h3 className="text-base font-heading font-bold text-foreground-900">KSB Progression</h3>
            <p className="mt-0.5 text-xs text-foreground-400">{groups.reduce((n, g) => n + g.done, 0)} of {groups.reduce((n, g) => n + g.total, 0)} KSBs evidenced through your activities</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key} className="group rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${g.chip}`}><i className={`${g.icon} text-base`}></i></span>
                  <div>
                    <span className="text-sm font-semibold text-foreground-900">{g.label}</span>
                    <p className="mt-0.5 text-[10px] text-foreground-400">{g.blurb}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-heading font-bold ${g.text}`}>{g.pct}%</p>
                  <p className="text-[9px] text-foreground-400">{g.done}/{g.total}</p>
                </div>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-background-200">
                <div className={`h-full ${g.bar} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${g.pct}%` }} />
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[10px] text-foreground-400">
                <span>{g.done} evidenced</span>
                <span>{Math.max(0, g.total - g.done)} remaining</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}

function LearningHistorySection({ real }: { real: LearnerDetail }) {
  const entries = real.activityFeed || [];
  const [visibleCount, setVisibleCount] = useState(6);
  const visibleEntries = entries.slice(0, visibleCount);
  if (entries.length === 0) return null;
  return (
    <section className="relative overflow-hidden rounded-3xl border border-foreground-100 bg-gradient-to-br from-background-50 via-primary-50/20 to-emerald-50/30 px-4 py-9 md:px-7">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary-200/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-200/20 blur-3xl" />
      <SectionHeading badge="Timeline" badgeIcon="ri-history-line" title="Learning History" subtitle="A complete record of your recent achievements and learning activity" tone="amber" />
      <div className="relative mt-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleEntries.map((entry, index) => (
            <article key={`${entry.at}-${index}`} className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white/90 p-5 shadow-[0_8px_28px_rgba(31,19,57,0.06)] backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_14px_36px_rgba(87,55,180,0.12)]">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-primary-400 to-primary-600 opacity-70" />
              <div className="flex items-start justify-between gap-3">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                  entry.passed === false ? 'bg-amber-100 text-amber-600' : entry.kind === 'quiz' ? 'bg-primary-100 text-primary-600' : 'bg-emerald-100 text-emerald-600'
                }`}>
                  <i className={`${entry.kind === 'quiz' ? 'ri-questionnaire-line' : entry.kind === 'video' ? 'ri-video-line' : 'ri-file-list-3-line'} text-lg`} />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                  <i className="ri-check-line" />Completed
                </span>
              </div>
              <div className="mt-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-foreground-400">
                  {entry.kind === 'quiz' ? 'Quiz' : entry.kind === 'video' ? 'Video activity' : entry.componentType || 'Learning activity'}
                </p>
                <h3 className="mt-1 line-clamp-2 text-sm font-heading font-bold leading-snug text-foreground-900">{entry.title || entry.action}</h3>
                <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-relaxed text-foreground-400">{entry.detail || entry.action}</p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-foreground-100 pt-3 text-[10px] text-foreground-400">
                <span><i className="ri-calendar-line mr-1" />{new Date(entry.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                {(entry.module || entry.week) && (
                  <span className="max-w-[55%] truncate"><i className="ri-book-open-line mr-1" />{entry.week || entry.module}</span>
                )}
              </div>
            </article>
          ))}
        </div>
        {entries.length > 6 && (
          <div className="relative z-20 mt-8 flex justify-center gap-2">
            {visibleCount < entries.length && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => Math.min(count + 6, entries.length))}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-smooth hover:bg-primary-600"
              >
                <i className="ri-add-line" />Show more
                <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px]">{entries.length - visibleCount} left</span>
              </button>
            )}
            {visibleCount > 6 && (
              <button
                type="button"
                onClick={() => setVisibleCount(6)}
                className="inline-flex items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 py-2.5 text-xs font-semibold text-foreground-600 transition-smooth hover:bg-background-100"
              >
                <i className="ri-arrow-up-line" />Show less
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function isJourneyComponentDone(component: JourneyModule['weeks'][number]['components'][number], real: LearnerDetail): boolean {
  if (component.isQuiz) return Boolean(component.quizAttempts?.length);
  if (isVideoComponent(component)) return Boolean(component.componentId && (real.videoProgress || []).some((item) => item.componentId === component.componentId));
  return Boolean(component.componentId && (real.componentProgress || []).some((item) => item.componentId === component.componentId));
}

function WeeklyLearningSection({ real, station }: { real: LearnerDetail; station: ModuleStation | null }) {
  const defaultWeekIndex = station
    ? Math.max(0, station.weekDots.findIndex((week) => week.total > 0 && week.done < week.total))
    : 0;
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(defaultWeekIndex);

  useEffect(() => {
    setSelectedWeekIndex(defaultWeekIndex);
  }, [defaultWeekIndex, station?.index]);

  if (!station) return null;
  const selectedWeek = station.module.weeks[selectedWeekIndex] || station.module.weeks[0];
  const activities = selectedWeek?.components || [];
  if (activities.length === 0) return null;

  const completedCount = activities.filter((component) => isJourneyComponentDone(component, real)).length;
  const completionPct = Math.round((completedCount / activities.length) * 100);
  const calendarDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <section className="overflow-hidden rounded-3xl border border-foreground-100 bg-background-50 shadow-[0_12px_36px_rgba(31,19,57,0.06)]">
      <header className="flex flex-col justify-between gap-4 border-b border-foreground-100 bg-gradient-to-r from-primary-50/70 via-background-50 to-emerald-50/40 px-5 py-4 md:flex-row md:items-center md:px-6">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-2.5 py-1 text-[9px] font-semibold text-primary-700">
            <i className="ri-calendar-2-line" />Weekly schedule
          </span>
          <h2 className="mt-2 text-xl font-heading font-bold text-foreground-950">Weekly Learning Calendar</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <p className="text-xs text-foreground-400">Module {station.index + 1} · {station.module.module}</p>
            <div className="flex items-center gap-3 text-[9px] font-medium text-foreground-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Completed</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />Not completed</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-background-300" />No activity</span>
            </div>
          </div>
        </div>

        <div className="flex w-full items-center overflow-hidden rounded-2xl border border-foreground-100 bg-white/90 p-1 shadow-sm backdrop-blur sm:w-auto">
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 sm:min-w-[180px]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <i className="ri-bar-chart-line text-sm" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[8px] font-semibold uppercase tracking-wider text-foreground-400">Week progress</p>
                <span className="text-[9px] font-bold text-emerald-600">{completionPct}%</span>
              </div>
              <p className="mt-0.5 text-xs font-bold text-foreground-900">{completedCount}/{activities.length} completed</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background-200">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${completionPct}%` }} />
              </div>
            </div>
          </div>
          <div className="my-2 h-10 w-px bg-foreground-100" />
          <div className="flex min-w-0 items-center gap-0.5 px-1 sm:min-w-[155px]">
            <button type="button" disabled={selectedWeekIndex === 0} onClick={() => setSelectedWeekIndex((index) => Math.max(0, index - 1))} className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground-500 transition hover:bg-primary-50 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-30" aria-label="Previous week"><i className="ri-arrow-left-s-line text-lg" /></button>
            <div className="min-w-[76px] flex-1 text-center">
              <p className="text-[8px] font-semibold uppercase tracking-wider text-foreground-400">Viewing</p>
              <p className="mt-0.5 text-[11px] font-bold text-foreground-900">{weekDisplayLabel(selectedWeek.week)}</p>
            </div>
            <button type="button" disabled={selectedWeekIndex >= station.module.weeks.length - 1} onClick={() => setSelectedWeekIndex((index) => Math.min(station.module.weeks.length - 1, index + 1))} className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground-500 transition hover:bg-primary-50 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-30" aria-label="Next week"><i className="ri-arrow-right-s-line text-lg" /></button>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto bg-background-100/35 p-3 md:p-4">
        <div className="grid min-w-[1120px] grid-cols-7 gap-2.5">
          {calendarDays.map((day, dayIndex) => {
            const dayActivities = activities.filter((_, activityIndex) => activityIndex % 7 === dayIndex);
            const weekend = dayIndex > 4;
            return (
              <div key={day} className={`min-h-[184px] rounded-2xl border p-2.5 transition-colors ${weekend ? 'border-foreground-100 bg-background-100/70' : 'border-foreground-100 bg-background-50'} ${dayIndex === 0 ? 'border-primary-200 bg-primary-50/45 shadow-[0_6px_22px_rgba(97,61,184,0.08)]' : ''}`}>
                <div className="flex items-center justify-between px-1 pb-2.5">
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${dayIndex === 0 ? 'text-primary-700' : 'text-foreground-500'}`}>{day.slice(0, 3)}</p>
                    <p className="mt-0.5 text-[8px] text-foreground-300">{dayActivities.length} {dayActivities.length === 1 ? 'activity' : 'activities'}</p>
                  </div>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${dayIndex === 0 ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20' : 'bg-background-50 text-foreground-600 ring-1 ring-foreground-200'}`}>{dayIndex + 1}</span>
                </div>

                <div className="space-y-2">
                  {dayActivities.length > 0 ? dayActivities.map((component, activityIndex) => {
                    const complete = isJourneyComponentDone(component, real);
                    const meta = componentTypeVisual(component.type || (component.isQuiz ? 'quiz' : 'activity'));
                    return (
                      <article key={component.componentId || `${component.title}-${activityIndex}`} className={`group relative min-h-[82px] overflow-hidden rounded-xl border bg-background-50 p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${complete ? 'border-emerald-200' : 'border-red-200'}`}>
                        <span className={`absolute inset-y-0 left-0 w-1 ${complete ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <div className="flex items-center justify-between gap-1.5 pl-1">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.cls}`}><i className={`${meta.icon} text-xs`} /></span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{complete ? 'Done' : 'Not completed'}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 pl-1 text-[10px] font-semibold leading-snug text-foreground-900">{component.title}</p>
                        <p className="mt-1.5 pl-1 text-[8px] text-foreground-400"><i className="ri-time-line mr-1" />{component.durationMinutes ? `${component.durationMinutes} min` : component.expectedOtjh ? `${component.expectedOtjh} OTJ hrs` : 'Self-paced'}</p>
                      </article>
                    );
                  }) : (
                    <div className="flex min-h-[90px] flex-col items-center justify-center rounded-xl border border-dashed border-foreground-100 text-center">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-background-100 text-foreground-300"><i className="ri-calendar-line text-sm" /></span>
                      <p className="mt-2 text-[9px] text-foreground-300">No activity</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function componentTypeVisual(type: string) {
  const value = type.toLowerCase();
  if (value.includes('video') || value.includes('live')) return { icon: 'ri-video-line', cls: 'bg-emerald-100 text-emerald-600' };
  if (value.includes('quiz')) return { icon: 'ri-questionnaire-line', cls: 'bg-primary-100 text-primary-600' };
  if (value.includes('reflection')) return { icon: 'ri-heart-line', cls: 'bg-pink-100 text-pink-600' };
  return { icon: 'ri-file-list-3-line', cls: 'bg-amber-100 text-amber-600' };
}

function AchievementsSection({ overallPct, modulesDone, quizzesPassed, attendanceRate, hours }: {
  overallPct: number; modulesDone: number; quizzesPassed: number; attendanceRate: number | null; hours: number;
}) {
  const badges = [
    { title: 'First Module Completed', text: 'Successfully completed your first module', earned: modulesDone > 0, icon: 'ri-medal-line' },
    { title: 'Perfect Attendance', text: 'Maintained excellent session attendance', earned: (attendanceRate || 0) >= 95, icon: 'ri-calendar-check-line' },
    { title: 'Quiz Master', text: 'Passed five or more quizzes', earned: quizzesPassed >= 5, icon: 'ri-lightbulb-line' },
    { title: 'Fast Learner', text: 'Reached 50% programme progress', earned: overallPct >= 50, icon: 'ri-rocket-line' },
    { title: 'OTJ Champion', text: 'Logged 100 off-the-job training hours', earned: hours >= 100, icon: 'ri-trophy-line' },
    { title: 'Graduation Ready', text: 'Complete all requirements to unlock', earned: overallPct >= 100, icon: 'ri-graduation-cap-line' },
  ];
  const earnedCount = badges.filter((badge) => badge.earned).length;

  return (
    <section className="overflow-hidden rounded-3xl border border-foreground-100 bg-gradient-to-br from-background-50 via-amber-50/20 to-primary-50/15 p-4 shadow-[0_10px_32px_rgba(31,19,57,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <i className="ri-trophy-line text-sm" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-heading font-bold text-foreground-900">Your Badges</h3>
            <p className="mt-0.5 truncate text-[10px] text-foreground-400">Milestones earned throughout your journey</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[9px] font-semibold text-amber-700">
          {earnedCount} of {badges.length} unlocked
        </span>
      </div>

      <div className="mt-4 grid w-full grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {badges.map((badge) => (
          <article
            key={badge.title}
            className={`group relative min-h-[98px] rounded-2xl border p-3 transition-all duration-300 ${
              badge.earned
                ? 'border-amber-200 bg-background-50 shadow-sm hover:-translate-y-0.5 hover:shadow-md'
                : 'border-foreground-100 bg-background-50/70'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-sm ${
                badge.earned
                  ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-400/20'
                  : 'bg-background-100 text-foreground-300'
              }`}>
                <i className={badge.icon} />
              </span>
              <i className={`${badge.earned ? 'ri-check-line text-emerald-500' : 'ri-lock-line text-foreground-300'} text-[10px]`} />
            </div>
            <p className={`mt-2.5 truncate text-[11px] font-semibold leading-snug ${
              badge.earned ? 'text-foreground-900' : 'text-foreground-500'
            }`}>{badge.title}</p>
            <p className="mt-1 line-clamp-1 text-[9px] leading-relaxed text-foreground-400">{badge.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function UpcomingTasksSection({ real, station }: { real: LearnerDetail; station: ModuleStation | null }) {
  if (!station) return null;
  const tasks = station.module.weeks
    .flatMap((week) => week.components.map((component) => ({ component, week: week.week })))
    .filter(({ component }) => !isJourneyComponentDone(component, real))
    .slice(0, 7);
  if (tasks.length === 0) return null;
  return (
    <section className="py-9">
      <SectionHeading badge="To Do" badgeIcon="ri-list-check-3" title="Upcoming Tasks" subtitle="Outstanding activities to complete in your current module" tone="primary" />
      <div className="mx-auto mt-7 max-w-[760px] space-y-3 px-4">
        {tasks.map(({ component, week }, index) => (
          <div key={component.componentId || index} className="flex items-center gap-3 rounded-2xl border border-foreground-100 bg-background-50 px-4 py-3.5 shadow-sm">
            <span className="h-5 w-5 rounded-md border border-foreground-200" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground-900">{component.title}</p>
              <p className="mt-1 text-[10px] text-foreground-400"><i className="ri-book-open-line mr-1" />{weekDisplayLabel(week)} · {component.durationMinutes ? `${component.durationMinutes} min` : 'Self-paced'}</p>
            </div>
            <span className={`h-2 w-2 rounded-full ${index < 3 ? 'bg-red-500' : 'bg-amber-500'}`} />
          </div>
        ))}
      </div>
    </section>
  );
}

function FinishLineSection({ overallPct, stations, totalActivities, doneActivities }: {
  overallPct: number; stations: ModuleStation[]; totalActivities: number; doneActivities: number;
}) {
  const modulesLeft = stations.filter((station) => station.status !== 'completed').length;
  return (
    <section className="rounded-2xl bg-gradient-to-b from-primary-50/80 to-background-50 px-4 py-12 text-center">
      <SectionHeading badge="The Finish Line" badgeIcon="ri-graduation-cap-line" title={overallPct >= 100 ? 'You Reached the Finish Line!' : 'Graduation Is Getting Closer'} subtitle="Keep going — every completed activity moves you closer to Gateway" tone="amber" />
      <div className="mx-auto mt-8 max-w-[460px] rounded-3xl border border-foreground-100 bg-background-50 p-7 shadow-sm">
        <HeroDonut pct={overallPct} />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <FinishStat value={modulesLeft} label="Modules Left" />
          <FinishStat value={Math.max(0, totalActivities - doneActivities)} label="Activities Left" />
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-background-200"><div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-amber-400" style={{ width: `${overallPct}%` }} /></div>
        <p className="mt-2 text-[10px] text-foreground-400">{overallPct}% of programme completed</p>
      </div>
      <a href="/learner/training-plan" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-smooth hover:bg-primary-600"><i className="ri-rocket-line" />Continue Learning Journey</a>
    </section>
  );
}

function FinishStat({ value, label }: { value: number; label: string }) {
  return <div className="rounded-2xl border border-foreground-100 bg-background-50 p-4"><p className="text-xl font-heading font-bold text-foreground-950">{value}</p><p className="mt-1 text-[10px] text-foreground-400">{label}</p></div>;
}

function SectionHeading({ badge, badgeIcon, title, subtitle, tone }: {
  badge: string; badgeIcon: string; title: string; subtitle: string; tone: 'primary' | 'amber';
}) {
  return (
    <div className="px-4 text-center">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold ${tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}><i className={badgeIcon} />{badge}</span>
      <h2 className="mt-3 text-2xl font-heading font-bold text-foreground-950 md:text-3xl">{title}</h2>
      <p className="mx-auto mt-1 max-w-xl text-sm text-foreground-400">{subtitle}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN VIEW
   ═══════════════════════════════════════════════════════ */
/** The "Your Trail to Gateway" quest map — reusable as an embedded section (e.g. on the learner overview page). */
export function TrailToGatewaySection({
  real, loading, loadError,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
}) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const { stations, overallPct, currentIndex } = useMemo(() => buildStations(journey, real), [journey, real]);
  const allDone = currentIndex === -1 && stations.length > 0;

  if (loading) return <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>;
  if (loadError) return <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>;
  if (journey.length === 0) return <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="No training plan built for this learner yet." /></div>;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary-100/60 bg-gradient-to-br from-background-50 via-primary-50/20 to-emerald-50/30 shadow-[0_12px_40px_rgba(31,19,57,0.05)]">
      {/* faint scenery */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute opacity-[0.16]" style={{ width: '46%', height: '30%', left: '-8%', top: '4%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-400) / 0.5) 0%, transparent 70%)', filter: 'blur(48px)' }} />
        <div className="absolute opacity-[0.14]" style={{ width: '44%', height: '26%', right: '-10%', top: '38%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-400) / 0.5) 0%, transparent 70%)', filter: 'blur(52px)' }} />
        <div className="absolute opacity-[0.12]" style={{ width: '50%', height: '28%', left: '-6%', bottom: '2%', background: 'radial-gradient(ellipse at center, #10b98166 0%, transparent 70%)', filter: 'blur(50px)' }} />
      </div>

      <div className="relative px-4 py-9 md:px-7 md:py-12">
        <div className="mx-auto mb-6 max-w-[1180px] text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 ring-1 ring-primary-200/60">
            <i className="ri-road-map-line" />Your Journey
          </span>
          <h2 className="mt-3 text-3xl font-heading font-bold tracking-tight text-foreground-950 md:text-4xl">Learning Roadmap</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-foreground-500">From enrolment to graduation — track every step of your learning journey</p>
        </div>

        <QuestTrail stations={stations} done={allDone} learnerName={real?.name || ''} travelled={allDone ? 1 : overallPct / 100} real={real!} />
      </div>
    </section>
  );
}

export function RealLearningJourneyView({
  real, loading, loadError, learnerKind, learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  learnerKind?: LearnerKind;
  learnerId?: string;
}) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);
  const evidencedKsbCodes = useMemo(() => {
    const defined = new Set((real?.ksbs || []).map((ksb) => ksb.code.trim().toUpperCase()));
    return Array.from(new Set(quizStats.ksbCodes.map((code) => code.trim().toUpperCase())))
      .filter((code) => defined.has(code));
  }, [quizStats.ksbCodes, real?.ksbs]);
  const { stations, overallPct, currentIndex, currentWeek } = useMemo(() => buildStations(journey, real), [journey, real]);

  const completedHours = parseHours(real?.completedHours);
  const plannedHours = parseHours(real?.plannedHours) || real?.totalExpectedOtjh || 0;
  const quizzesPassed = stations.reduce((n, s) => n + s.quizPassed, 0);
  const allDone = currentIndex === -1 && stations.length > 0;

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const currentStation = currentIndex >= 0 ? stations[currentIndex] : null;
  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<JourneyMetricData | null>(null);

  useEffect(() => {
    if (!learnerKind || !learnerId) return;
    let cancelled = false;
    fetchLearnerAttendance(learnerKind, learnerId)
      .then((record) => { if (!cancelled) setAttendance(record); })
      .catch(() => { if (!cancelled) setAttendance(null); });
    return () => { cancelled = true; };
  }, [learnerKind, learnerId]);

  const initials = (real?.name || 'Learner')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const completedModules = stations.filter((station) => station.status === 'completed').length;
  const completedActivities = stations.reduce((total, station) => total + station.trackableDone, 0);
  const totalActivities = stations.reduce((total, station) => total + station.trackableTotal, 0);
  const ksbTotal = real?.ksbs.length || 0;
  const ksbProgress = ksbTotal ? Math.round((evidencedKsbCodes.length / ksbTotal) * 100) : 0;
  const evidencedKsbSet = new Set(evidencedKsbCodes.map((code) => code.trim().toUpperCase()));
  const ksbGroupValue = (type: 'K' | 'S' | 'B') => {
    const items = (real?.ksbs || []).filter((ksb) => (ksb.type || ksb.code || '').trim().toUpperCase().startsWith(type));
    const evidenced = items.filter((ksb) => evidencedKsbSet.has(ksb.code.trim().toUpperCase())).length;
    return `${evidenced} / ${items.length}`;
  };
  const metrics: JourneyMetricData[] = [
    {
      icon: 'ri-pie-chart-line', label: 'Overall Progress', value: `${overallPct}%`, detail: 'Programme completion',
      description: 'Your completion across all trackable learning activities in the programme.', progress: overallPct,
      rows: [
        { label: 'Activities completed', value: `${completedActivities} / ${totalActivities}` },
        { label: 'Activities remaining', value: String(Math.max(0, totalActivities - completedActivities)) },
        { label: 'Current module', value: currentStation ? `Module ${currentStation.index + 1}` : 'All complete' },
      ],
    },
    {
      icon: 'ri-stack-line', label: 'Modules Completed', value: `${completedModules} / ${stations.length}`,
      detail: currentStation ? `Module ${currentStation.index + 1} current` : 'All complete',
      description: 'A breakdown of completed, current, and upcoming programme modules.',
      progress: stations.length ? Math.round((completedModules / stations.length) * 100) : 0,
      rows: [
        { label: 'Completed', value: String(completedModules) },
        { label: 'In progress', value: currentStation ? '1' : '0' },
        { label: 'Upcoming', value: String(Math.max(0, stations.length - completedModules - (currentStation ? 1 : 0))) },
      ],
    },
    {
      icon: 'ri-briefcase-4-line', label: 'OTJ Hours', value: formatHoursMinutes(completedHours),
      detail: plannedHours ? `Target: ${plannedHours}h` : 'Logged hours',
      description: 'Off-the-job training hours logged against your programme target.',
      progress: plannedHours ? Math.min(100, Math.round((completedHours / plannedHours) * 100)) : 0,
      rows: [
        { label: 'Hours logged', value: formatHoursMinutes(completedHours) },
        { label: 'Programme target', value: plannedHours ? `${plannedHours}h` : 'Not set' },
        { label: 'Hours remaining', value: plannedHours ? formatHoursMinutes(Math.max(0, plannedHours - completedHours)) : '—' },
      ],
    },
    {
      icon: 'ri-calendar-check-line', label: 'Attendance', value: attendance ? `${attendance.attendanceRate}%` : '—',
      detail: attendance ? `${attendance.present}/${attendance.sessions} sessions` : 'No record',
      description: 'Your attendance record across all scheduled learning sessions.', progress: attendance?.attendanceRate || 0,
      rows: [
        { label: 'Present', value: attendance ? String(attendance.present) : '—' },
        { label: 'Absent', value: attendance ? String(attendance.absent) : '—' },
        { label: 'Late', value: attendance ? String(attendance.late) : '—' },
        { label: 'Catch-up sessions', value: attendance ? String(attendance.catchup) : '—' },
      ],
    },
    {
      icon: 'ri-award-line', label: 'KSBs Evidenced', value: `${evidencedKsbCodes.length} / ${ksbTotal}`,
      detail: `${ksbProgress}% evidenced`, description: 'Knowledge, skills, and behaviours evidenced by your completed learning.', progress: ksbProgress,
      rows: [
        { label: 'Knowledge', value: ksbGroupValue('K') },
        { label: 'Skills', value: ksbGroupValue('S') },
        { label: 'Behaviours', value: ksbGroupValue('B') },
      ],
    },
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
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════ LEARNER PROFILE + QUICK STATS ═══════════ */}
        <section className="relative overflow-hidden rounded-3xl border border-primary-100/70 bg-gradient-to-br from-background-50 via-primary-50/30 to-secondary-50/40 px-5 py-6 shadow-[0_16px_50px_rgba(41,20,82,0.08)] md:px-8 md:py-8">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-primary-300/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-secondary-300/10 blur-3xl" />
          <div className="relative w-full">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
              <div className="flex min-w-0 items-center gap-4">
                <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-500 to-primary-700 text-2xl font-heading font-bold text-white shadow-xl shadow-primary-500/20">
                  {initials}
                  <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-white ring-4 ring-background-50"><i className="ri-check-line text-xs" /></span>
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-heading font-bold tracking-tight text-foreground-950 md:text-3xl">{real?.name || 'Learner'}</h1>
                  <p className="mt-1 text-sm text-foreground-500">{real?.programme || 'Learning programme'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {real?.cohort && <ProfileChip icon="ri-team-line" text={real.cohort} tone="primary" />}
                    {currentStation && <ProfileChip icon="ri-book-open-line" text={`Module ${currentStation.index + 1} — ${currentStation.module.module}`} tone="blue" />}
                    {currentWeek && <ProfileChip icon="ri-calendar-line" text={weekDisplayLabel(currentWeek)} tone="neutral" />}
                  </div>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-3 rounded-2xl border border-white/70 bg-white/55 p-2 backdrop-blur">
                <ProfileInfo icon="ri-building-line" label="Employer" value={real?.employer || 'Not assigned'} tone="amber" />
                <ProfileInfo icon="ri-user-star-line" label="Line Manager" value={real?.lineManager || 'Not assigned'} tone="primary" />
                <ProfileInfo icon="ri-fire-line" label="Programme Status" value={real?.programmeStatus || (real?.isActive ? 'Active' : 'Inactive')} tone="primary" />
                <ProfileInfo icon="ri-time-line" label="Total OTJ Hours" value={formatHoursMinutes(completedHours)} tone="primary" />
              </div>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {metrics.map((metric) => <JourneyMetric key={metric.label} metric={metric} onClick={() => setSelectedMetric(metric)} />)}
            </div>
          </div>
        </section>

        {/* ═══════════ QUEST TRAIL ═══════════ */}
        <TrailToGatewaySection real={real} loading={loading} loadError={loadError} />

        {/* ═══════════ KSB PROGRESSION ═══════════ */}
        {real && !loading && !loadError && <KsbSection real={real} evidencedCodes={evidencedKsbCodes} />}

        {real && !loading && !loadError && <WeeklyLearningSection real={real} station={currentStation} />}

        {!loading && !loadError && (
          <AchievementsSection
            overallPct={overallPct}
            modulesDone={completedModules}
            quizzesPassed={quizzesPassed}
            attendanceRate={attendance?.attendanceRate ?? null}
            hours={completedHours}
          />
        )}

      </div>
      {selectedMetric && <JourneyMetricModal metric={selectedMetric} onClose={() => setSelectedMetric(null)} />}
    </WorkspaceShell>
  );
}

function ProfileChip({ icon, text, tone }: { icon: string; text: string; tone: 'primary' | 'blue' | 'neutral' }) {
  const cls = tone === 'primary'
    ? 'bg-primary-100 text-primary-700'
    : tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-background-100 text-foreground-600';
  return <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${cls}`}><i className={icon} /><span className="truncate">{text}</span></span>;
}

function ProfileInfo({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'amber' | 'primary' }) {
  return (
    <div className="flex min-w-[165px] items-center gap-3 rounded-xl border border-foreground-100 bg-background-50 px-3 py-2.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-primary-100 text-primary-600'}`}><i className={icon} /></span>
      <div className="min-w-0">
        <p className="text-[10px] text-foreground-400">{label}</p>
        <p className="truncate text-xs font-semibold text-foreground-900">{value}</p>
      </div>
    </div>
  );
}

function JourneyMetric({ metric, onClick }: { metric: JourneyMetricData; onClick: () => void }) {
  const { icon, label, value, detail } = metric;
  return (
    <button type="button" onClick={onClick} aria-label={`View ${label} details`} className="group relative flex min-h-[145px] flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/90 p-4 text-left shadow-[0_6px_20px_rgba(31,19,57,0.04)] backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_14px_30px_rgba(86,52,177,0.11)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-primary-400 via-secondary-400 to-emerald-400 opacity-0 transition-opacity group-hover:opacity-100" />
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-primary-50 text-primary-600 ring-1 ring-inset ring-primary-100"><i className={`${icon} text-base`} /></span>
      <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{value}</p>
      <p className="mt-auto flex items-center gap-1 pt-2 text-[10px] font-medium text-emerald-600"><i className="ri-pulse-line" />{detail}</p>
    </button>
  );
}

function JourneyMetricModal({ metric, onClose }: { metric: JourneyMetricData; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-primary-950/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="journey-metric-title" className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-background-50 shadow-[0_30px_100px_rgba(20,8,45,0.35)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 px-6 py-6 text-white">
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"><i className="ri-close-line text-lg" /></button>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-xl ring-1 ring-inset ring-white/20"><i className={metric.icon} /></span>
          <p className="mt-4 text-[10px] font-semibold uppercase tracking-widest !text-white/70">{metric.label}</p>
          <h2 id="journey-metric-title" className="mt-1 text-3xl font-heading font-bold !text-white">{metric.value}</h2>
          <p className="mt-2 pr-8 text-sm !text-white/75">{metric.description}</p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-white transition-all" style={{ width: `${Math.max(0, Math.min(100, metric.progress))}%` }} /></div>
          <p className="mt-2 text-right text-[10px] font-semibold !text-white/70">{metric.progress}%</p>
        </div>
        <div className="space-y-2 p-5">
          {metric.rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-2xl border border-foreground-100 bg-white px-4 py-3">
              <span className="text-xs text-foreground-500">{row.label}</span>
              <span className="text-sm font-bold text-foreground-900">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
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
