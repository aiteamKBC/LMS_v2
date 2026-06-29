import { useState } from 'react';
import { Link } from 'react-router-dom';

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
export interface RoadModule {
  id: string;
  title: string;
  shortTitle: string;
  weeks: string;
  weekRange: string;
  progress: number;
  status: 'Completed' | 'In Progress' | 'Upcoming' | 'Locked' | 'Gateway';
  tutor: string;
  startDate: string;
  endDate: string;
  icon: string;
  summary: string;
  themes: string[];
  assignments: number;
  assignmentsCompleted: number;
  quizzes: number;
  quizzesPassed: number;
  evidence: number;
  evidenceApproved: number;
  otjhExpected: number;
  otjhEarned: number;
  ksbCount: number;
  ksbsAchieved: number;
}

/* ═══════════════════════════════════════════════════════════════
   STATUS COLOR SYSTEM
   ═══════════════════════════════════════════════════════════════ */
type MetroStatus = 'Completed' | 'In Progress' | 'Upcoming' | 'Locked' | 'Gateway' | 'Certificate';

const METRO_COLORS: Record<MetroStatus, { line: string; lineBg: string; dot: string; dotRing: string; glow: string; badge: string; badgeText: string; cardAccent: string }> = {
  Completed:   { line: '#059669', lineBg: '#d1fae5', dot: '#059669', dotRing: '#a7f3d0', glow: '#6ee7b7', badge: '#ecfdf5', badgeText: '#065f46', cardAccent: '#059669' },
  'In Progress': { line: '#7c3aed', lineBg: '#ede9fe', dot: '#7c3aed', dotRing: '#c4b5fd', glow: '#a78bfa', badge: '#f5f3ff', badgeText: '#5b21b6', cardAccent: '#7c3aed' },
  Upcoming:    { line: '#9ca3af', lineBg: '#f3f4f6', dot: '#9ca3af', dotRing: '#e5e7eb', glow: '#d1d5db', badge: '#f9fafb', badgeText: '#4b5563', cardAccent: '#9ca3af' },
  Locked:      { line: '#d1d5db', lineBg: '#f9fafb', dot: '#d1d5db', dotRing: '#f3f4f6', glow: '#e5e7eb', badge: '#f9fafb', badgeText: '#9ca3af', cardAccent: '#d1d5db' },
  Gateway:     { line: '#d97706', lineBg: '#fef3c7', dot: '#d97706', dotRing: '#fcd34d', glow: '#fbbf24', badge: '#fffbeb', badgeText: '#92400e', cardAccent: '#d97706' },
  Certificate: { line: '#b45309', lineBg: '#fef3c7', dot: '#b45309', dotRing: '#fde68a', glow: '#f59e0b', badge: '#fffbeb', badgeText: '#78350f', cardAccent: '#b45309' },
};

function statusToMetro(s: RoadModule['status']): MetroStatus {
  return s === 'Gateway' ? 'Gateway' : s;
}

/* ═══════════════════════════════════════════════════════════════
   STATION GEOMETRY — BIG WAVE: "قاع وتل" (valley & hill)
   Top stations at y=240, bottom stations at y=520
   280px wave amplitude. Cards 228x172. viewBox 2200x720.
   ═══════════════════════════════════════════════════════════════ */
interface Station {
  id: string;
  modIndex: number; // -1 for cert
  x: number;
  y: number;
  above: boolean; // card placement
}

const STATION_GAP = 260;
const FIRST_X = 160;

const STATIONS: Station[] = [
  { id: 'mod-01', modIndex: 0, x: FIRST_X + 0 * STATION_GAP, y: 240, above: true },
  { id: 'mod-02', modIndex: 1, x: FIRST_X + 1 * STATION_GAP, y: 520, above: false },
  { id: 'mod-03', modIndex: 2, x: FIRST_X + 2 * STATION_GAP, y: 240, above: true },
  { id: 'mod-04', modIndex: 3, x: FIRST_X + 3 * STATION_GAP, y: 520, above: false },
  { id: 'mod-05', modIndex: 4, x: FIRST_X + 4 * STATION_GAP, y: 240, above: true },
  { id: 'mod-06', modIndex: 5, x: FIRST_X + 5 * STATION_GAP, y: 520, above: false },
  { id: 'mod-07', modIndex: 6, x: FIRST_X + 6 * STATION_GAP, y: 240, above: true },
  { id: 'cert',   modIndex: -1, x: FIRST_X + 7 * STATION_GAP, y: 520, above: false },
];

const CARD_W = 228;
const CARD_H = 172;
const CONNECTOR_GAP = 20;

function cardY(stationY: number, above: boolean): number {
  return above ? stationY - CONNECTOR_GAP - CARD_H : stationY + CONNECTOR_GAP;
}
function cardX(stationX: number): number {
  return stationX - CARD_W / 2;
}

/* ═══════════════════════════════════════════════════════════════
   SVG PATH — smooth S-shaped metro line (big wave)
   ═══════════════════════════════════════════════════════════════ */
const METRO_PATH =
  'M 160 240 ' +
  'C 290 240, 290 520, 420 520 ' +
  'C 550 520, 550 240, 680 240 ' +
  'C 810 240, 810 520, 940 520 ' +
  'C 1070 520, 1070 240, 1200 240 ' +
  'C 1330 240, 1330 520, 1460 520 ' +
  'C 1590 520, 1590 240, 1720 240 ' +
  'C 1850 240, 1850 520, 1980 520';

/* Segment paths between adjacent station pairs */
const SEGMENTS: { from: number; to: number; d: string }[] = [
  { from: 0, to: 1, d: 'M 160 240 C 290 240, 290 520, 420 520' },
  { from: 1, to: 2, d: 'M 420 520 C 550 520, 550 240, 680 240' },
  { from: 2, to: 3, d: 'M 680 240 C 810 240, 810 520, 940 520' },
  { from: 3, to: 4, d: 'M 940 520 C 1070 520, 1070 240, 1200 240' },
  { from: 4, to: 5, d: 'M 1200 240 C 1330 240, 1330 520, 1460 520' },
  { from: 5, to: 6, d: 'M 1460 520 C 1590 520, 1590 240, 1720 240' },
  { from: 6, to: 7, d: 'M 1720 240 C 1850 240, 1850 520, 1980 520' },
];

/* ═══════════════════════════════════════════════════════════════
   MODULE CARD — rendered via SVG foreignObject
   ═══════════════════════════════════════════════════════════════ */
function ModuleCard({ mod, index, x, y, above }: { mod: RoadModule; index: number; x: number; y: number; above: boolean }) {
  const metro = METRO_COLORS[statusToMetro(mod.status)];
  const isLocked = mod.status === 'Locked';
  const totalLessons = mod.quizzes + mod.evidence;
  const completedLessons = mod.quizzesPassed + mod.evidenceApproved;

  return (
    <foreignObject x={x} y={y} width={CARD_W} height={CARD_H}>
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        className="w-full h-full rounded-xl bg-white border border-gray-100 flex flex-col overflow-hidden cursor-pointer transition-shadow duration-200 hover:border-gray-200 group"
        style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.03), 0 1px 3px rgba(0,0,0,0.04)' }}
      >
        {/* top accent bar */}
        <div className="h-1 shrink-0" style={{ backgroundColor: metro.cardAccent, opacity: isLocked ? 0.3 : 1 }}></div>

        {/* header */}
        <div className="px-3.5 pt-2.5 pb-1.5 flex items-start gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-xs font-bold font-label"
            style={{
              backgroundColor: isLocked ? '#f3f4f6' : metro.dotRing,
              color: isLocked ? '#d1d5db' : metro.badgeText,
            }}
          >
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-gray-900 leading-tight truncate font-sans" style={{ fontFamily: 'var(--font-heading), Inter, system-ui, sans-serif' }}>
              {mod.shortTitle}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5 font-sans">{mod.weekRange}</p>
          </div>
          {/* status badge */}
          <span
            className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap font-label"
            style={{ backgroundColor: metro.badge, color: metro.badgeText }}
          >
            {mod.status === 'Completed' ? 'Done' : mod.status === 'In Progress' ? `${mod.progress}%` : mod.status === 'Gateway' ? 'Gateway' : mod.status === 'Locked' ? 'Locked' : 'Upcoming'}
          </span>
        </div>

        {/* progress bar */}
        <div className="px-3.5 pb-2">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${mod.progress}%`, backgroundColor: metro.line, opacity: isLocked ? 0.25 : 1 }}
            ></div>
          </div>
        </div>

        {/* stats row */}
        <div className="px-3.5 pb-2 flex items-center gap-3 text-[11px] text-gray-500 font-sans">
          <span className="flex items-center gap-1">
            <i className="ri-book-open-line text-gray-300 text-[11px]"></i>
            <span className={mod.quizzesPassed === mod.quizzes && mod.quizzes > 0 ? 'text-emerald-600 font-medium' : ''}>{mod.quizzes}</span>
            <span className="text-gray-300">lessons</span>
          </span>
          <span className="flex items-center gap-1">
            <i className="ri-file-text-line text-gray-300 text-[11px]"></i>
            <span className={mod.assignmentsCompleted === mod.assignments && mod.assignments > 0 ? 'text-emerald-600 font-medium' : ''}>{mod.assignments}</span>
            <span className="text-gray-300">tasks</span>
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <i className="ri-time-line text-gray-300 text-[11px]"></i>
            <span>{mod.otjhExpected}h</span>
          </span>
        </div>

        {/* continue / action button */}
        <div className="px-3.5 pb-3 mt-auto">
          {mod.status === 'In Progress' ? (
            <Link
              to="/learner/this-week"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-semibold text-white transition-colors duration-200 whitespace-nowrap cursor-pointer font-label"
              style={{ backgroundColor: metro.line }}
              onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              <i className="ri-play-circle-line text-[13px]"></i>Continue
            </Link>
          ) : mod.status === 'Completed' ? (
            <button
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-medium text-gray-500 bg-gray-50 border border-gray-100 transition-colors duration-200 whitespace-nowrap cursor-pointer font-label hover:bg-gray-100"
            >
              <i className="ri-check-double-line text-[13px]"></i>Review
            </button>
          ) : mod.status === 'Gateway' ? (
            <Link
              to="/learner/gateway"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-semibold text-white transition-colors duration-200 whitespace-nowrap cursor-pointer font-label"
              style={{ backgroundColor: metro.line }}
              onMouseOver={(e) => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              <i className="ri-shield-check-line text-[13px]"></i>Prepare
            </Link>
          ) : (
            <button
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-medium bg-gray-50 border border-gray-100 transition-colors duration-200 whitespace-nowrap cursor-pointer font-label"
              style={{ color: isLocked ? '#d1d5db' : '#9ca3af' }}
              disabled={isLocked}
            >
              {isLocked ? (
                <><i className="ri-lock-line text-[13px]"></i>Locked</>
              ) : (
                <><i className="ri-eye-line text-[13px]"></i>Preview</>
              )}
            </button>
          )}
        </div>
      </div>
    </foreignObject>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
interface RoadJourneyViewProps {
  modules: RoadModule[];
  currentWeek: number;
  totalWeeks: number;
  overallProgress: number;
  programme: string;
  programmeLevel: string;
  onStationClick: (modId: string) => void;
}

export default function RoadJourneyView({ modules, currentWeek, totalWeeks, overallProgress, programme, programmeLevel, onStationClick }: RoadJourneyViewProps) {
  const [activeStation, setActiveStation] = useState<number | null>(null);

  const completedCount = modules.filter(m => m.status === 'Completed').length;
  const inProgressMod = modules.find(m => m.status === 'In Progress');
  const remainingCount = modules.length - completedCount - (inProgressMod ? 1 : 0);

  const currentModIdx = modules.findIndex(m => m.status === 'In Progress');

  return (
    <div className="animate-in fade-in duration-500">
      <div className="bg-background-50 rounded-2xl border border-background-200/60 overflow-hidden">
        {/* ── Header ── */}
        <div className="px-5 md:px-7 py-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-background-200/40">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
              <i className="ri-subway-line text-violet-500 text-[15px]"></i>
            </span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Your Learning Road</h3>
              <p className="text-xs text-foreground-400">{programme} {programmeLevel} · Week {currentWeek} of {totalWeeks}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold whitespace-nowrap font-label">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>{completedCount} Done
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 text-xs font-semibold whitespace-nowrap animate-pulse font-label">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>{inProgressMod ? 1 : 0} Active
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-50 text-gray-500 text-xs font-semibold whitespace-nowrap font-label">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>{remainingCount} Ahead
            </span>
          </div>
        </div>

        {/* ── Metro Map Canvas ── */}
        <div className="overflow-x-auto">
          <div className="min-w-[1100px]">
            <svg viewBox="0 0 2200 720" className="w-full" style={{ maxHeight: '720px' }} xmlns="http://www.w3.org/2000/svg">
              <defs>
                {/* glow filters */}
                <filter id="metro-glow-completed" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="metro-glow-current" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="8" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="metro-glow-gold" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>

                {/* grid pattern for subtle texture */}
                <pattern id="metro-grid" patternUnits="userSpaceOnUse" width="32" height="32">
                  <rect width="32" height="32" fill="none" />
                  <circle cx="16" cy="16" r="0.8" fill="#e5e7eb" opacity="0.5" />
                </pattern>
              </defs>

              {/* background grid */}
              <rect x="0" y="0" width="2200" height="720" fill="url(#metro-grid)" />

              {/* ═══════════ BACKGROUND TRACK (light gray) ═══════════ */}
              <path d={METRO_PATH} fill="none" stroke="#f3f4f6" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
              <path d={METRO_PATH} fill="none" stroke="#e5e7eb" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />

              {/* ═══════════ COLORED SEGMENTS ═══════════ */}
              {SEGMENTS.map((seg, i) => {
                const station = STATIONS[seg.from];
                const mod = station.modIndex >= 0 ? modules[station.modIndex] : null;
                const status: MetroStatus = mod ? statusToMetro(mod.status) : 'Certificate';
                const colors = METRO_COLORS[status];
                const isCurrent = status === 'In Progress';
                const progressPct = mod?.progress ?? 0;

                if (isCurrent) {
                  return (
                    <g key={`seg-${i}`}>
                      {/* completed portion */}
                      <path
                        d={seg.d}
                        fill="none" stroke={METRO_COLORS.Completed.line} strokeWidth="6"
                        strokeLinecap="round" pathLength="100"
                        strokeDasharray={`${progressPct} 100`}
                      />
                      {/* remaining portion */}
                      <path
                        d={seg.d}
                        fill="none" stroke="#e5e7eb" strokeWidth="6"
                        strokeLinecap="round" pathLength="100"
                        strokeDasharray={`${100 - progressPct} 100`}
                        strokeDashoffset={`-${progressPct}`}
                      />
                    </g>
                  );
                }

                return (
                  <g key={`seg-${i}`}>
                    <path
                      d={seg.d} fill="none" stroke={colors.line} strokeWidth="6"
                      strokeLinecap="round"
                      filter={status === 'Completed' ? 'url(#metro-glow-completed)' : status === 'Gateway' ? 'url(#metro-glow-gold)' : undefined}
                      opacity={status === 'Locked' ? 0.35 : 1}
                    />
                  </g>
                );
              })}

              {/* ═══════════ STATION DOTS ═══════════ */}
              {STATIONS.map((st, i) => {
                const isCert = st.modIndex === -1;
                const mod = !isCert ? modules[st.modIndex] : null;
                const status: MetroStatus = isCert ? 'Certificate' : mod ? statusToMetro(mod.status) : 'Locked';
                const colors = METRO_COLORS[status];
                const isCurrent = status === 'In Progress';
                const isActive = activeStation === i;

                return (
                  <g
                    key={`station-${st.id}`}
                    className="cursor-pointer"
                    onClick={() => {
                      setActiveStation(isActive ? null : i);
                      if (mod) onStationClick(mod.id);
                    }}
                  >
                    {/* glow ring for current & gateway */}
                    {(isCurrent || status === 'Gateway') && (
                      <circle cx={st.x} cy={st.y} r="16" fill={colors.glow} opacity="0.2" className="animate-pulse">
                        <animate attributeName="r" values="14;18;14" dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.2;0.35;0.2" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* station dot ring */}
                    <circle
                      cx={st.x} cy={st.y} r="9" fill="white"
                      stroke={colors.dotRing} strokeWidth="2.5"
                      filter={isCurrent ? 'url(#metro-glow-current)' : status === 'Completed' ? 'url(#metro-glow-completed)' : status === 'Gateway' || status === 'Certificate' ? 'url(#metro-glow-gold)' : undefined}
                    />

                    {/* station dot fill */}
                    <circle cx={st.x} cy={st.y} r="5.5" fill={colors.dot} />

                    {/* center dot for current */}
                    {isCurrent && (
                      <circle cx={st.x} cy={st.y} r="2.5" fill="white">
                        <animate attributeName="opacity" values="0.6;1;0.6" dur="1.8s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* checkmark for completed */}
                    {status === 'Completed' && (
                      <text x={st.x} y={st.y + 3.5} textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="remixicon">✓</text>
                    )}

                    {/* hover ring on active */}
                    {isActive && (
                      <circle cx={st.x} cy={st.y} r="13" fill="none" stroke={colors.dot} strokeWidth="1.5" opacity="0.3" />
                    )}

                    {/* connector line to card */}
                    <line
                      x1={st.x} y1={st.y} x2={st.x}
                      y2={st.above ? st.y - CONNECTOR_GAP : st.y + CONNECTOR_GAP}
                      stroke={colors.dot} strokeWidth="1.5" opacity="0.5"
                    />
                  </g>
                );
              })}

              {/* ═══════════ CERTIFICATE DESTINATION ═══════════ */}
              {(() => {
                const certSt = STATIONS[7];
                const certColors = METRO_COLORS.Certificate;
                return (
                  <g>
                    {/* large glow */}
                    <circle cx={certSt.x} cy={certSt.y} r="22" fill={certColors.glow} opacity="0.18" className="animate-pulse">
                      <animate attributeName="r" values="20;26;20" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.15;0.28;0.15" dur="3s" repeatCount="indefinite" />
                    </circle>
                    {/* outer ring */}
                    <circle cx={certSt.x} cy={certSt.y} r="15" fill="white" stroke={certColors.dotRing} strokeWidth="3" filter="url(#metro-glow-gold)" />
                    {/* inner fill */}
                    <circle cx={certSt.x} cy={certSt.y} r="10" fill={certColors.dot} />
                    {/* badge icon */}
                    <text x={certSt.x} y={certSt.y + 3.5} textAnchor="middle" fill="white" fontSize="9" fontFamily="remixicon" fontWeight="bold">★</text>
                    {/* label plaque */}
                    <rect x={certSt.x - 46} y={certSt.y + 32} width="92" height="32" rx="8" fill="white" stroke="#fde68a" strokeWidth="1.5" filter="url(#metro-glow-gold)" />
                    <text x={certSt.x} y={certSt.y + 50} textAnchor="middle" fill="#78350f" fontSize="10" fontWeight="700" fontFamily="var(--font-heading), Inter, sans-serif">Certificate</text>
                    <text x={certSt.x} y={certSt.y + 58} textAnchor="middle" fill="#a16207" fontSize="8" fontFamily="var(--font-label), Inter, sans-serif">Level {programmeLevel.split(' ')[1] || '3'}</text>
                  </g>
                );
              })()}

              {/* ═══════════ CARDS ═══════════ */}
              {STATIONS.filter(st => st.modIndex >= 0).map((st, displayIdx) => {
                const mod = modules[st.modIndex];
                if (!mod) return null;
                const cy = cardY(st.y, st.above);
                const cx = cardX(st.x);
                return (
                  <ModuleCard key={mod.id} mod={mod} index={displayIdx} x={cx} y={cy} above={st.above} />
                );
              })}

              {/* ═══════════ YOU ARE HERE indicator on current station ═══════════ */}
              {currentModIdx >= 0 && (() => {
                const cs = STATIONS[currentModIdx];
                if (!cs) return null;
                const cardTop = cardY(cs.y, cs.above);
                const badgeY = cs.above ? cardTop - 28 : cs.y - 28;
                const connectorEnd = cs.above ? cardTop : cs.y;
                return (
                  <g>
                    <rect x={cs.x - 56} y={badgeY} width="112" height="24" rx="6" fill="#7c3aed" filter="url(#metro-glow-current)" />
                    <text x={cs.x} y={badgeY + 16} textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="var(--font-label), Inter, sans-serif">YOU ARE HERE</text>
                    <line x1={cs.x} y1={badgeY + 24} x2={cs.x} y2={connectorEnd} stroke="#7c3aed" strokeWidth="1.5" strokeDasharray="2 3" />
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="border-t border-background-200/40 px-5 md:px-7 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-[11px] text-foreground-500 font-sans">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500"></span>
            <span className="text-[11px] text-foreground-500 font-sans">Current</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
            <span className="text-[11px] text-foreground-500 font-sans">Upcoming</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-300"></span>
            <span className="text-[11px] text-foreground-500 font-sans">Locked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <span className="text-[11px] text-foreground-500 font-sans">Gateway</span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="w-4 h-4 rounded-md bg-amber-100 flex items-center justify-center text-[8px] text-amber-600 font-bold">★</span>
            <span className="text-[11px] text-foreground-400 font-sans">Certificate</span>
          </div>
        </div>
      </div>
    </div>
  );
}