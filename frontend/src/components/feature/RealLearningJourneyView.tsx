import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
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

function QuestTrail({ stations, done, learnerName, travelled }: { stations: ModuleStation[]; done: boolean; learnerName: string; travelled: number }) {
  return (
    <>
      {/* Desktop / tablet: the winding road */}
      <div className="hidden md:block">
        <WindingRoad stations={stations} done={done} learnerName={learnerName} travelled={travelled} />
      </div>
      {/* Mobile: vertical rail fallback */}
      <div className="md:hidden">
        <RoadStack stations={stations} done={done} learnerName={learnerName} travelled={travelled} />
      </div>
    </>
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
    const evidenced = new Set(evidencedCodes);
    const defs = [
      { key: 'K', label: 'Knowledge', icon: 'ri-book-open-line', chip: 'bg-primary-100 text-primary-600', bar: 'bg-primary-500', text: 'text-primary-600', blurb: 'Theory, frameworks and concepts' },
      { key: 'S', label: 'Skills', icon: 'ri-tools-line', chip: 'bg-amber-100 text-amber-600', bar: 'bg-amber-500', text: 'text-amber-600', blurb: 'Practical application at work' },
      { key: 'B', label: 'Behaviours', icon: 'ri-heart-line', chip: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', text: 'text-emerald-600', blurb: 'Professional conduct and mindset' },
    ];
    return defs.map((d) => {
      // KSB type arrives as a single letter ("K"/"S"/"B"); fall back to the code's first letter.
      const items = (real.ksbs || []).filter((k) => ((k.type || k.code || '').trim().toUpperCase()[0] === d.key));
      const done = items.filter((k) => evidenced.has(k.code)).length;
      return { ...d, total: items.length, done, pct: items.length > 0 ? Math.round((done / items.length) * 100) : 0 };
    });
  }, [real, evidencedCodes]);

  if (groups.every((g) => g.total === 0)) return null;

  return (
    <Reveal>
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
    </Reveal>
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
    <section className="relative rounded-2xl border border-foreground-200/60 bg-gradient-to-b from-background-50 via-background-100/40 to-background-50 overflow-hidden">
      {/* faint scenery */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute opacity-[0.16]" style={{ width: '46%', height: '30%', left: '-8%', top: '4%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-400) / 0.5) 0%, transparent 70%)', filter: 'blur(48px)' }} />
        <div className="absolute opacity-[0.14]" style={{ width: '44%', height: '26%', right: '-10%', top: '38%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-400) / 0.5) 0%, transparent 70%)', filter: 'blur(52px)' }} />
        <div className="absolute opacity-[0.12]" style={{ width: '50%', height: '28%', left: '-6%', bottom: '2%', background: 'radial-gradient(ellipse at center, #10b98166 0%, transparent 70%)', filter: 'blur(50px)' }} />
      </div>

      <div className="relative px-3 md:px-6 pt-5 md:pt-6 pb-8">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap max-w-[840px] mx-auto">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center"><i className="ri-road-map-line text-primary-600 text-sm"></i></span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Your Trail to Gateway</h3>
              <p className="text-xs text-foreground-400">The trail fills as you complete activities — every checkpoint is a module.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-500"><i className="ri-checkbox-circle-fill text-emerald-500"></i>Completed</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-500"><i className="ri-flag-2-fill text-primary-500"></i>In progress</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-500"><i className="ri-lock-2-line text-foreground-400"></i>Upcoming</span>
          </div>
        </div>

        <QuestTrail stations={stations} done={allDone} learnerName={real?.name || ''} travelled={allDone ? 1 : overallPct / 100} />
      </div>
    </section>
  );
}

export function RealLearningJourneyView({
  real, loading, loadError,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
}) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);
  const { stations, overallPct, currentIndex, currentWeek } = useMemo(() => buildStations(journey, real), [journey, real]);

  const totalWeeks = journey.reduce((n, m) => n + m.weeks.length, 0);
  const totalComponents = journey.reduce((n, m) => n + m.weeks.reduce((k, w) => k + w.components.length, 0), 0);
  const completedHours = parseHours(real?.completedHours);
  const plannedHours = parseHours(real?.plannedHours) || real?.totalExpectedOtjh || 0;
  const quizzesPassed = stations.reduce((n, s) => n + s.quizPassed, 0);
  const quizTotal = stations.reduce((n, s) => n + s.quizTotal, 0);
  const videosDone = stations.reduce((n, s) => n + s.videoDone, 0);
  const videoTotal = stations.reduce((n, s) => n + s.videoTotal, 0);
  const allDone = currentIndex === -1 && stations.length > 0;

  const otjhStatus = (real?.otjhStatus || '').trim();
  const otjhPill = otjhStatus.toLowerCase() === 'on track'
    ? { cls: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25', icon: 'ri-checkbox-circle-line' }
    : otjhStatus.toLowerCase() === 'at risk'
      ? { cls: 'bg-red-400/15 text-red-300 border-red-400/25', icon: 'ri-alarm-warning-line' }
      : { cls: 'bg-amber-400/15 text-amber-300 border-amber-400/25', icon: 'ri-error-warning-line' };

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const currentStation = currentIndex >= 0 ? stations[currentIndex] : null;

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

        {/* ═══════════ HERO ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            <div className="absolute animate-liquid-blob-3 opacity-10" style={{ width: '50%', height: '25%', left: '20%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
          </div>

          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[190px]">
            <div className="flex-1 px-5 md:px-8 py-6 md:py-7 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                {subtitle && <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md border border-accent-400/15">{subtitle}</span>}
                {otjhStatus && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${otjhPill.cls}`}>
                    <i className={otjhPill.icon}></i>{otjhStatus}
                  </span>
                )}
              </div>
              <h1 className="text-xl md:text-2xl font-heading font-bold text-white tracking-tight mb-1.5">My Learning Journey</h1>
              <p className="text-sm text-white/45 max-w-xl mb-5">
                {journey.length} {journey.length === 1 ? 'module' : 'modules'} · {totalWeeks} {totalWeeks === 1 ? 'week' : 'weeks'} · {totalComponents} {totalComponents === 1 ? 'activity' : 'activities'}
                {currentStation && <> · currently on <span className="text-white/80 font-semibold">Module {currentStation.index + 1}</span>{currentWeek ? <span className="text-white/80 font-semibold"> · {weekDisplayLabel(currentWeek)}</span> : null}</>}
                {allDone && <> · <span className="text-emerald-300 font-semibold">all modules complete <i className="ri-sparkling-2-line"></i></span></>}
              </p>

              <div className="flex items-center gap-5 md:gap-8 flex-wrap">
                <div>
                  <p className="text-xl md:text-2xl font-heading font-bold text-white leading-none">
                    <CountUp value={completedHours} decimals={completedHours % 1 ? 1 : 0} /><span className="text-white/35 text-sm font-normal"> / {plannedHours}h</span>
                  </p>
                  <p className="text-[10px] text-white/45 uppercase tracking-wider mt-1.5 font-semibold">OTJ Hours</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div>
                  <p className="text-xl md:text-2xl font-heading font-bold text-white leading-none">
                    <CountUp value={quizzesPassed} /><span className="text-white/35 text-sm font-normal"> / {quizTotal}</span>
                  </p>
                  <p className="text-[10px] text-white/45 uppercase tracking-wider mt-1.5 font-semibold">Quizzes Passed</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div>
                  <p className="text-xl md:text-2xl font-heading font-bold text-white leading-none">
                    <CountUp value={videosDone} /><span className="text-white/35 text-sm font-normal"> / {videoTotal}</span>
                  </p>
                  <p className="text-[10px] text-white/45 uppercase tracking-wider mt-1.5 font-semibold">Videos Watched</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div>
                  <p className="text-xl md:text-2xl font-heading font-bold text-white leading-none"><CountUp value={quizStats.ksbCount} /></p>
                  <p className="text-[10px] text-white/45 uppercase tracking-wider mt-1.5 font-semibold">KSBs Evidenced</p>
                </div>
              </div>
            </div>

            <div className="lg:w-[260px] shrink-0 px-5 md:px-7 py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
              <HeroDonut pct={overallPct} />
            </div>
          </div>
        </section>

        {/* ═══════════ QUEST TRAIL ═══════════ */}
        <TrailToGatewaySection real={real} loading={loading} loadError={loadError} />

        {/* ═══════════ KSB PROGRESSION ═══════════ */}
        {real && !loading && !loadError && <KsbSection real={real} evidencedCodes={quizStats.ksbCodes} />}

        {/* ═══════════ SNAPSHOT ═══════════ */}
        {real && !loading && !loadError && journey.length > 0 && (
          <Reveal delay={80}>
            <section>
              <div className="flex items-center gap-3 mb-4">
                <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center"><i className="ri-dashboard-line text-foreground-500 text-sm"></i></span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Journey Snapshot</h3>
                  <p className="text-xs text-foreground-400">Your progress in numbers</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <SnapshotTile label="Overall Progress" value={`${overallPct}%`} icon="ri-pie-chart-line" iconBg="bg-primary-100 text-primary-600" />
                <SnapshotTile label="Modules Done" value={`${stations.filter((s) => s.status === 'completed').length}/${stations.length}`} icon="ri-book-2-line" iconBg="bg-emerald-100 text-emerald-600" />
                <SnapshotTile label="Quizzes Passed" value={quizTotal > 0 ? `${quizzesPassed}/${quizTotal}` : '—'} icon="ri-questionnaire-line" iconBg="bg-amber-100 text-amber-600" />
                <SnapshotTile label="Videos Watched" value={videoTotal > 0 ? `${videosDone}/${videoTotal}` : '—'} icon="ri-play-circle-line" iconBg="bg-red-100 text-red-600" />
                <SnapshotTile label="OTJ Hours" value={`${formatHoursMinutes(completedHours)} / ${plannedHours}h`} icon="ri-time-line" iconBg="bg-secondary-100 text-secondary-600" />
                <SnapshotTile label="KSBs Evidenced" value={`${quizStats.ksbCount}`} icon="ri-award-line" iconBg="bg-primary-100 text-primary-600" />
              </div>
            </section>
          </Reveal>
        )}
      </div>
    </WorkspaceShell>
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
