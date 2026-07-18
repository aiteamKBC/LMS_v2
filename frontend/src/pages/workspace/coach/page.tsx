import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  DEFAULT_COACH_EMAIL,
  type CoachCalendarEvent,
  eventDisplayDate,
  eventPeriodLabel,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskEvent,
  isCompletedEvent,
  parseLocalDate,
  sortEvents,
} from '../../coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;

type OtjhFilter = 'all' | 'at-risk' | 'need-attention' | 'on-track';
type OtjhStatusKey = 'at-risk' | 'need-attention' | 'on-track' | 'unknown';
type PerformanceStatus = 'on-track' | 'at-risk' | 'high' | 'new-starter';

const EMPTY_VALUE = '--';
const CASELOAD_ENDPOINT = `/coach_api/coach/caseload?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;

interface CoachLearner {
  id: string;
  name: string;
  initials: string;
  programme: string;
  employer: string;
  avatar: string;
  status: PerformanceStatus;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  otjhCompleted: number;
  otjhTarget: number;
  otjhStatus?: string | null;
  ksbProgress: number;
  ksbProgressAvailable?: boolean;
  evidenceCount: number;
  evidenceCountAvailable?: boolean;
  nextCoaching: string;
  nextReview: string;
  lastContact: string;
  recentFlag: string | null;
  email?: string | null;
  rawProgramStatus?: string | null;
}

interface CaseloadApiLearner extends Partial<CoachLearner> {
  cohortName?: string | null;
}

interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}

function displayValue(value?: string | number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const text = String(value).trim();
  if (!text || text === EMPTY_VALUE || text === '—') return EMPTY_VALUE;
  return text;
}

function toNumber(value?: number | string | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function clampPercent(value?: number | string | null): number {
  return Math.max(0, Math.min(100, Math.round(toNumber(value))));
}

function statusFromApi(value?: string | null): PerformanceStatus {
  if (value === 'at-risk' || value === 'high' || value === 'new-starter') return value;
  return 'on-track';
}

function normalizeOtjhStatus(value?: string | null): OtjhStatusKey {
  const normalized = displayValue(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'atrisk') return 'at-risk';
  if (normalized === 'needattention' || normalized === 'needsattention') return 'need-attention';
  if (normalized === 'ontrack') return 'on-track';
  return 'unknown';
}

const OTJH_STATUS_META: Record<OtjhStatusKey, { label: string; cardLabel: string; sub: string; color: 'primary' | 'emerald' | 'red' | 'amber'; bg: string; text: string; bar: string; avatar: string }> = {
  'at-risk': {
    label: 'At Risk',
    cardLabel: 'At Risk',
    sub: 'OTJH at risk',
    color: 'red',
    bg: 'bg-red-50 border-red-200/50',
    text: 'text-red-700',
    bar: 'bg-red-500',
    avatar: 'bg-red-100 text-red-700 ring-red-200',
  },
  'need-attention': {
    label: 'Need Attention',
    cardLabel: 'Need Attention',
    sub: 'Needs support',
    color: 'amber',
    bg: 'bg-amber-50 border-amber-200/50',
    text: 'text-amber-700',
    bar: 'bg-amber-500',
    avatar: 'bg-amber-100 text-amber-700 ring-amber-200',
  },
  'on-track': {
    label: 'On Track',
    cardLabel: 'On Track',
    sub: 'On target',
    color: 'emerald',
    bg: 'bg-emerald-50 border-emerald-200/50',
    text: 'text-emerald-700',
    bar: 'bg-emerald-500',
    avatar: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  },
  unknown: {
    label: EMPTY_VALUE,
    cardLabel: 'Unknown',
    sub: 'No OTJH status',
    color: 'primary',
    bg: 'bg-foreground-50 border-foreground-200/50',
    text: 'text-foreground-600',
    bar: 'bg-foreground-400',
    avatar: 'bg-foreground-100 text-foreground-600 ring-foreground-200',
  },
};

function normalizeLearner(learner: CaseloadApiLearner, index: number): CoachLearner {
  const name = displayValue(learner.name);
  const fallbackName = name === EMPTY_VALUE ? `Learner ${index + 1}` : name;
  const initials = displayValue(learner.initials);
  const id = displayValue(learner.id);
  const programme = displayValue(learner.programme) === EMPTY_VALUE ? displayValue(learner.cohortName) : displayValue(learner.programme);

  return {
    id: id === EMPTY_VALUE ? `learner-${index}` : id,
    name: fallbackName,
    initials: initials === EMPTY_VALUE ? fallbackName.slice(0, 2).toUpperCase() : initials,
    programme,
    employer: displayValue(learner.employer),
    avatar: displayValue(learner.avatar),
    status: statusFromApi(learner.status),
    riskFlags: Array.isArray(learner.riskFlags) ? learner.riskFlags.filter(Boolean) : [],
    overallProgress: clampPercent(learner.overallProgress),
    overallProgressAvailable: learner.overallProgressAvailable,
    attendanceRate: clampPercent(learner.attendanceRate),
    attendanceRateAvailable: learner.attendanceRateAvailable,
    otjhCompleted: toNumber(learner.otjhCompleted),
    otjhTarget: Math.max(toNumber(learner.otjhTarget), 0),
    otjhStatus: displayValue(learner.otjhStatus),
    ksbProgress: clampPercent(learner.ksbProgress),
    ksbProgressAvailable: learner.ksbProgressAvailable,
    evidenceCount: toNumber(learner.evidenceCount),
    evidenceCountAvailable: learner.evidenceCountAvailable,
    nextCoaching: displayValue(learner.nextCoaching),
    nextReview: displayValue(learner.nextReview),
    lastContact: displayValue(learner.lastContact),
    recentFlag: displayValue(learner.recentFlag) === EMPTY_VALUE ? null : String(learner.recentFlag),
    email: learner.email || null,
    rawProgramStatus: learner.rawProgramStatus || null,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function getFirstName(name: string) {
  const value = displayValue(name);
  return value === EMPTY_VALUE ? 'Coach' : value.split(/\s+/)[0];
}

function eventMatchesLearner(event: CoachCalendarEvent, learner: CoachLearner) {
  const eventLearnerId = displayValue(event.learnerId);
  const learnerId = displayValue(learner.id);
  if (eventLearnerId !== EMPTY_VALUE && eventLearnerId === learnerId) return true;

  const eventEmail = displayValue(event.email).toLowerCase();
  const learnerEmail = displayValue(learner.email).toLowerCase();
  if (eventEmail !== EMPTY_VALUE && learnerEmail !== EMPTY_VALUE && eventEmail === learnerEmail) return true;

  return displayValue(event.learner).toLowerCase() === learner.name.toLowerCase();
}

function nextEventDateForLearner(events: CoachCalendarEvent[], learner: CoachLearner, source: string) {
  const match = sortEvents(events).find(event => (
    event.source === source && eventMatchesLearner(event, learner) && !isCompletedEvent(event)
  ));
  return match ? formatDateLabel(eventDisplayDate(match)) : EMPTY_VALUE;
}

function enrichLearnerSchedule(learners: CoachLearner[], events: CoachCalendarEvent[]) {
  return learners.map(learner => ({
    ...learner,
    nextCoaching: nextEventDateForLearner(events, learner, 'mcr'),
    nextReview: nextEventDateForLearner(events, learner, 'progress-review'),
  }));
}

function isWithinNextDays(event: CoachCalendarEvent, daysAhead: number) {
  const date = parseLocalDate(eventDisplayDate(event));
  if (!date || isCompletedEvent(event)) return false;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + daysAhead);
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function formatCalendarMonth(events: CoachCalendarEvent[]) {
  const first = events.map(event => parseLocalDate(eventDisplayDate(event))).find(Boolean);
  if (!first) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(first);
}

function formatCalendarDay(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date).toUpperCase();
}

function formatCalendarDayNumber(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit' }).format(date);
}

function eventTypeLabel(event: CoachCalendarEvent) {
  if (event.source === 'progress-review') return eventPeriodLabel(event);
  if (event.source === 'mcr') return 'Monthly Coaching';
  return displayValue(event.title);
}

function eventStatusClasses(event: CoachCalendarEvent) {
  if (isAtRiskEvent(event)) {
    return {
      row: 'bg-red-50/80 border border-red-200/50',
      date: 'text-red-600',
      badge: 'bg-red-100 text-red-700',
      icon: 'ri-alert-fill text-red-500',
    };
  }
  if (event.status === 'scheduled' || event.status === 'in-progress') {
    return {
      row: 'bg-background-100/50 hover:bg-background-100',
      date: 'text-foreground-400',
      badge: 'bg-amber-100 text-amber-700',
      icon: 'ri-time-line text-amber-500',
    };
  }
  if (isCompletedEvent(event)) {
    return {
      row: 'hover:bg-background-50',
      date: 'text-foreground-400',
      badge: 'bg-primary-100 text-primary-700',
      icon: 'ri-check-line text-emerald-500',
    };
  }
  return {
    row: 'bg-background-100/50 hover:bg-background-100',
    date: 'text-foreground-400',
    badge: 'bg-orange-100 text-orange-700',
    icon: 'ri-calendar-schedule-line text-orange-500',
  };
}

function buildRiskSummary(learners: CoachLearner[]) {
  return learners
    .slice(0, 4)
    .map(learner => `${learner.name}: ${learner.riskFlags[0] || learner.recentFlag || 'Needs attention'}`)
    .join('. ');
}

/* ═══════════════════════════════════════════════════════════
   Scroll Reveal
   ═══════════════════════════════════════════════════════════ */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`transition-all duration-[500ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Donut Ring
   ═══════════════════════════════════════════════════════════ */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-white/8' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = {
    primary: 'stroke-primary-400', accent: 'stroke-accent-400', secondary: 'stroke-secondary-400',
    emerald: 'stroke-emerald-400', amber: 'stroke-amber-400', red: 'stroke-red-400',
  };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   Progress Bar
   ═══════════════════════════════════════════════════════════ */
function ProgressBar({ pct, color, height = 3 }: { pct: number; color: string; height?: number }) {
  const barColors: Record<string, string> = {
    primary: 'bg-primary-500', accent: 'bg-accent-500', secondary: 'bg-secondary-500',
    emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500',
  };
  return (
    <div className="w-full rounded-full bg-background-200 overflow-hidden" style={{ height }}>
      <div className={`h-full rounded-full transition-all duration-700 ease-out ${barColors[color] || 'bg-primary-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export default function CoachDashboard() {
  const [viewMode, setViewMode] = useState<OtjhFilter>('all');
  const [selectedLearner, setSelectedLearner] = useState<CoachLearner | null>(null);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [learners, setLearners] = useState<CoachLearner[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CoachCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setLoadWarning(null);
      const warnings: string[] = [];

      const [caseloadResult, timetableResult] = await Promise.allSettled([
        fetch(CASELOAD_ENDPOINT, { signal: controller.signal }).then(response => readJson<CaseloadApiResponse>(response)),
        fetchCoachCalendarEvents(controller.signal),
      ]);

      if (controller.signal.aborted) return;

      if (caseloadResult.status === 'fulfilled') {
        setOwnerName(displayValue(caseloadResult.value.owner?.name) === EMPTY_VALUE ? 'Med Maher' : String(caseloadResult.value.owner?.name));
        setLearners((caseloadResult.value.learners || []).map(normalizeLearner));
      } else {
        setLearners([]);
        warnings.push('caseload');
      }

      if (timetableResult.status === 'fulfilled') {
        setCalendarEvents(sortEvents(timetableResult.value.events || []));
        if (displayValue(timetableResult.value.owner?.name) !== EMPTY_VALUE) {
          setOwnerName(String(timetableResult.value.owner?.name));
        }
      } else {
        setCalendarEvents([]);
        warnings.push('calendar');
      }

      setLoadWarning(warnings.length ? `Unable to load ${warnings.join(', ')} data right now.` : null);
      setLoading(false);
    }

    loadDashboard();
    return () => controller.abort();
  }, []);

  const enrichedLearners = useMemo(() => enrichLearnerSchedule(learners, calendarEvents), [learners, calendarEvents]);

  const filteredLearners = viewMode === 'all'
    ? enrichedLearners
    : enrichedLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === viewMode);

  const atRiskLearners = enrichedLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'at-risk');
  const needAttentionLearners = enrichedLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'need-attention');
  const onTrackLearners = enrichedLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'on-track');
  const atRiskCount = atRiskLearners.length;
  const needAttentionCount = needAttentionLearners.length;
  const onTrackCount = onTrackLearners.length;
  const totalCaseload = enrichedLearners.length;
  const pendingEvidence: number | null = null;
  const reviewsNext14 = calendarEvents.filter(event => event.source === 'progress-review' && isWithinNextDays(event, 14)).length;
  const visibleCalendarEvents = sortEvents(calendarEvents.filter(event => !isCompletedEvent(event))).slice(0, 9);
  const riskSummary = buildRiskSummary(atRiskLearners);
  const riskNames = atRiskLearners.slice(0, 3).map(learner => learner.name).join(', ') || EMPTY_VALUE;
  const overdueCalendarEvents = calendarEvents.filter(event => isAtRiskEvent(event)).length;

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Coach Dashboard" pageSubtitle="Monitor learner progress, manage coaching sessions, and review evidence"
      userName={ownerName} userRole="Progress Coach"
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════════════════════════════════════════════
            SECTION 1 — HERO BANNER
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={0}>
          <section className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
            <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
            {/* blobs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
              <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            </div>
            {/* avatar */}
            <div className="absolute right-8 bottom-0 top-0 w-1/2 hidden md:flex items-end justify-end pointer-events-none">
              <img
                src="https://public.readdy.ai/ai/img_res/63cca6b6-155e-4d44-9b95-588ef15c4704.png"
                alt="Coach"
                className="h-full w-auto object-contain object-bottom"
                style={{ maxHeight: '115%', transform: 'translateY(8%)' }}
              />
            </div>
            <div className="relative h-full flex flex-col justify-center p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                <div className="flex-1 min-w-0 max-w-xl">
                  <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Good morning, {getFirstName(ownerName)}</h1>
                  <p className="text-[13px] text-white/50 max-w-lg">
                    Manage your complete caseload. Track learner progress, review evidence, and schedule coaching sessions.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 2 — KPI STAT CARDS
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={60}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Caseload" value={String(totalCaseload)} sub={`${onTrackCount} on track`} icon="ri-group-line" color="primary" />
            <StatCard label="On Track" value={String(onTrackCount)} sub={OTJH_STATUS_META['on-track'].sub} icon="ri-checkbox-circle-line" color={OTJH_STATUS_META['on-track'].color} />
            <StatCard label="At Risk" value={String(atRiskCount)} sub={OTJH_STATUS_META['at-risk'].sub} icon="ri-alert-line" color={OTJH_STATUS_META['at-risk'].color} />
            <StatCard label="Need Attention" value={String(needAttentionCount)} sub={OTJH_STATUS_META['need-attention'].sub} icon="ri-error-warning-line" color={OTJH_STATUS_META['need-attention'].color} />
            <StatCard label="Evidence" value={pendingEvidence === null ? EMPTY_VALUE : String(pendingEvidence)} sub="Source pending" icon="ri-file-search-line" color="secondary" />
            <StatCard label="Reviews" value={String(reviewsNext14)} sub="Next 14 days" icon="ri-file-chart-line" color="primary" />
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 3 — RISK ALERT BANNER
            ═══════════════════════════════════════════════════ */}
        {(loading || loadWarning) && (
          <SectionReveal delay={70}>
            <div className={`rounded-xl border p-3 text-[12px] ${loadWarning ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-background-50 border-foreground-200/60 text-foreground-500'}`}>
              {loading ? 'Loading live coach dashboard data...' : loadWarning}
            </div>
          </SectionReveal>
        )}

        {atRiskCount > 0 && (
          <SectionReveal delay={80}>
            <div className="bg-red-50/70 border border-red-200/50 rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <i className="ri-alert-fill text-red-600 text-base"></i>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Risk Alert: {atRiskCount} learners need immediate attention</p>
                <p className="text-[12px] text-red-600 mt-0.5 truncate">
                  {riskSummary || EMPTY_VALUE}
                </p>
              </div>
            </div>
          </SectionReveal>
        )}

        {/* ═══════════════════════════════════════════════════
            MAIN CONTENT — 2 Columns
            ═══════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">

          {/* ─────── Left Column (2/3) ─────── */}
          <div className="lg:col-span-2 space-y-5 md:space-y-6">

            {/* Learner Caseload */}
            <SectionReveal delay={100}>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Learner Caseload</h2>
                    <p className="text-sm text-foreground-400 mt-0.5">All {totalCaseload} learners assigned to you — click to expand details</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link to="/coach/caseload" className="text-xs font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                      <i className="ri-table-line mr-1"></i> Full Overview
                    </Link>
                    <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
                    {([
                      { key: 'all', label: 'All', count: totalCaseload },
                      { key: 'at-risk', label: OTJH_STATUS_META['at-risk'].cardLabel, count: atRiskCount },
                      { key: 'need-attention', label: OTJH_STATUS_META['need-attention'].cardLabel, count: needAttentionCount },
                      { key: 'on-track', label: OTJH_STATUS_META['on-track'].cardLabel, count: onTrackCount },
                    ] as { key: OtjhFilter; label: string; count: number }[]).map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => setViewMode(tab.key)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                          viewMode === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
                        }`}
                      >
                        {tab.label} <span className="text-[10px] opacity-60">({tab.count})</span>
                      </button>
                    ))}
                  </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {filteredLearners.map(learner => (
                    <LearnerRow
                      key={learner.id}
                      learner={learner}
                      isSelected={selectedLearner?.id === learner.id}
                      onSelect={() => setSelectedLearner(selectedLearner?.id === learner.id ? null : learner)}
                    />
                  ))}
                  {filteredLearners.length === 0 && (
                    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6 text-center text-[12px] text-foreground-400">
                      {loading ? 'Loading learners...' : 'No learners found.'}
                    </div>
                  )}
                </div>
              </section>
            </SectionReveal>

            {/* Upcoming Live Sessions */}
            <SectionReveal delay={140}>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Upcoming Live Sessions</h2>
                    <p className="text-sm text-foreground-400 mt-0.5">Sessions your learners should attend this week</p>
                  </div>
                  <Link to="/coach/timetable" className="text-xs font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                    <i className="ri-calendar-line mr-1"></i> Full Calendar
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{EMPTY_VALUE}</span>
                      <span className="text-[9px] text-foreground-400">{EMPTY_VALUE}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-foreground-900 mb-2 leading-snug">Live session source not connected</p>
                    <div className="space-y-1 text-[11px] text-foreground-400">
                      <p><i className="ri-stack-line mr-1 text-[10px]"></i> Module: {EMPTY_VALUE}</p>
                      <p><i className="ri-user-line mr-1 text-[10px]"></i> Learners: {EMPTY_VALUE}</p>
                      <p><i className="ri-user-settings-line mr-1 text-[10px]"></i> Tutor: {EMPTY_VALUE}</p>
                      <p><i className="ri-video-line mr-1 text-[10px]"></i> Platform: {EMPTY_VALUE}</p>
                    </div>
                  </div>
                </div>
              </section>
            </SectionReveal>

            {/* Evidence Queue */}
            <SectionReveal delay={180}>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Evidence Awaiting Review</h2>
                    <p className="text-sm text-foreground-400 mt-0.5">Evidence source is not confirmed yet</p>
                  </div>
                  <Link to="/coach/marking-queue" className="text-xs font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                    View All <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                  <div className="p-6 text-center text-[12px] text-foreground-400">
                    <div className="mx-auto mb-2 w-9 h-9 rounded-lg bg-background-100 flex items-center justify-center text-foreground-400">
                      <i className="ri-file-search-line text-sm"></i>
                    </div>
                    <p className="font-medium text-foreground-600">Evidence data source pending</p>
                    <p className="mt-1">{EMPTY_VALUE}</p>
                  </div>
                </div>
              </section>
            </SectionReveal>
          </div>

          {/* ─────── Right Column (1/3) ─────── */}
          <div className="space-y-5 md:space-y-5">

            {/* Coaching Calendar */}
            <SectionReveal delay={120}>
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Coaching Calendar</h3>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{formatCalendarMonth(visibleCalendarEvents)}</span>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {visibleCalendarEvents.length === 0 && (
                    <div className="p-6 text-center text-[12px] text-foreground-400">
                      {loading ? 'Loading calendar...' : 'No calendar events found.'}
                    </div>
                  )}
                  {visibleCalendarEvents.map(event => {
                    const classes = eventStatusClasses(event);
                    const displayDate = eventDisplayDate(event);
                    return (
                      <div key={event.eventKey || event.id} className={`flex items-start gap-3 p-2.5 rounded-lg transition-smooth cursor-pointer ${classes.row}`}>
                        <div className="text-center shrink-0 min-w-[42px]">
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${classes.date}`}>{formatCalendarDay(displayDate)}</p>
                          <p className={`text-base font-bold ${isAtRiskEvent(event) ? 'text-red-700' : 'text-foreground-900'}`}>{formatCalendarDayNumber(displayDate)}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground-900">{displayValue(event.learner)}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-foreground-400">{formatTimeLabel(event)}</span>
                            <span className="text-[8px] text-foreground-300">&middot;</span>
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${classes.badge}`}>{eventTypeLabel(event)}</span>
                          </div>
                        </div>
                        <i className={`text-sm shrink-0 ${classes.icon}`}></i>
                      </div>
                    );
                  })}
                </div>
              </section>
            </SectionReveal>

            {/* Absence Reports */}
            <SectionReveal delay={160}>
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">
                    Absence Reports
                    <span className="ml-2 text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{EMPTY_VALUE} pending</span>
                  </h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background-100/50">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-100 text-amber-600">
                      <i className="ri-emotion-sad-line text-sm"></i>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-foreground-900 truncate">Live absence source not connected</p>
                      <p className="text-[10px] text-foreground-400 truncate">Date {EMPTY_VALUE} - reason {EMPTY_VALUE}</p>
                    </div>
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">
                      {EMPTY_VALUE}
                    </span>
                  </div>
                </div>
              </section>
            </SectionReveal>

            {/* AI Insights */}
            <SectionReveal delay={200}>
              <section className="bg-gradient-to-br from-background-50 to-background-100 rounded-xl border border-primary-200/40 p-4 md:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center">
                    <i className="ri-robot-line text-primary-600 text-sm"></i>
                  </span>
                  <h3 className="text-sm font-heading font-semibold text-primary-900">AI Insights</h3>
                </div>
                <div className="space-y-3">
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-[11px] text-foreground-700 leading-relaxed">
                      <strong>Risk focus:</strong> {atRiskCount ? `${atRiskCount} learner(s) need attention. Prioritise ${riskNames}.` : EMPTY_VALUE}
                    </p>
                  </div>
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-[11px] text-foreground-700 leading-relaxed">
                      <strong>Calendar focus:</strong> {calendarEvents.length ? `${overdueCalendarEvents} overdue event(s), ${reviewsNext14} review(s) in the next 14 days.` : EMPTY_VALUE}
                    </p>
                  </div>
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-[11px] text-foreground-700 leading-relaxed">
                      <strong>Evidence focus:</strong> {EMPTY_VALUE}
                    </p>
                  </div>
                </div>
              </section>
            </SectionReveal>
          </div>
        </div>

      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════════
   Hero Stat Pill
   ═══════════════════════════════════════════════════════════ */
function HeroStatPill({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    accent: 'bg-accent-400/15 text-accent-300 border-accent-400/20',
    primary: 'bg-primary-400/15 text-primary-300 border-primary-400/20',
    secondary: 'bg-secondary-400/15 text-secondary-300 border-secondary-400/20',
    emerald: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/20',
    red: 'bg-red-400/15 text-red-300 border-red-400/20',
    amber: 'bg-amber-400/15 text-amber-300 border-amber-400/20',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${colorMap[color] || colorMap.primary} backdrop-blur-sm`}>
      <i className={`${icon} text-xs opacity-70`}></i>
      <span className="text-[10px] font-bold">{value}</span>
      <span className="text-[10px] opacity-60 whitespace-nowrap">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Mini Donut Stat (Hero)
   ═══════════════════════════════════════════════════════════ */
function MiniDonutStat({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <DonutRing pct={pct} size={44} stroke={4} color={color} trackClass="text-white/8" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white">{pct}%</span>
        </div>
      </div>
      <span className="text-[9px] text-white/40 font-medium">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Stat Card
   ═══════════════════════════════════════════════════════════ */
function StatCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; accent: string }> = {
    primary: { iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700' },
    accent: { iconBg: 'bg-accent-50', iconText: 'text-accent-700', accent: 'text-accent-700' },
    secondary: { iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', accent: 'text-secondary-700' },
    red: { iconBg: 'bg-red-100', iconText: 'text-red-600', accent: 'text-red-700' },
    amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700' },
    emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', accent: 'text-emerald-700' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 card-premium cursor-pointer">
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconText}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className="text-[10px] md:text-[11px] text-foreground-400 font-medium">{label}</span>
      </div>
      <p className={`text-lg md:text-xl font-heading font-bold leading-tight ${c.accent}`}>{value}</p>
      <p className="text-[10px] md:text-[11px] text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Learner Row
   ═══════════════════════════════════════════════════════════ */
function LearnerRow({ learner, isSelected, onSelect }: { learner: CoachLearner; isSelected: boolean; onSelect: () => void }) {
  const sc = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
  const otjhLabel = learner.otjhTarget > 0 ? `${learner.otjhCompleted}/${learner.otjhTarget}` : EMPTY_VALUE;
  const ksbLabel = learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE;
  const attendanceLabel = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
  const progressLabel = learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE;
  const evidenceLabel = learner.evidenceCountAvailable ? String(learner.evidenceCount) : EMPTY_VALUE;
  const attendanceTone = learner.attendanceRateAvailable
    ? learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'
    : 'text-foreground-900';

  return (
    <div
      className={`bg-background-50 rounded-xl border p-4 card-premium cursor-pointer transition-smooth ${isSelected ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${sc.avatar}`}>
          <span className="text-sm font-bold">{learner.initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground-900">{learner.name}</p>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
            {learner.recentFlag && (
              <span className="text-[9px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">{learner.recentFlag}</span>
            )}
          </div>
          <p className="text-[11px] text-foreground-400 mt-0.5">{learner.programme} · {learner.employer}</p>
        </div>
        <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
          <span>OTJH: {otjhLabel}</span>
          <span>KSB: {ksbLabel}</span>
          <span>Att: {attendanceLabel}</span>
        </div>
        <i className={`text-foreground-300 shrink-0 ${isSelected ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
      </div>

      {/* Risk flags */}
      {learner.riskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 ml-14">
          {learner.riskFlags.map(flag => (
            <span key={flag} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">{flag}</span>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      {isSelected && (
        <div className="mt-4 ml-14 grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-background-200/30">
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Progress</p>
            <div className="w-full bg-background-200 rounded-full h-2 mb-1.5">
              <div className={`h-2 rounded-full transition-smooth ${sc.bar}`} style={{ width: `${learner.overallProgressAvailable ? learner.overallProgress : 0}%` }}></div>
            </div>
            <p className="text-lg font-bold text-foreground-900">{progressLabel}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Attendance</p>
            <p className={`text-lg font-bold ${attendanceTone}`}>{attendanceLabel}</p>
            <p className="text-[10px] text-foreground-400">{learner.attendanceRateAvailable ? learner.attendanceRate >= 90 ? 'On target' : 'Below 90%' : EMPTY_VALUE}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Next Coaching</p>
            <p className="text-sm font-semibold text-foreground-900">{learner.nextCoaching}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Evidence</p>
            <p className="text-lg font-bold text-foreground-900">{evidenceLabel}</p>
            <p className="text-[10px] text-foreground-400">items submitted</p>
          </div>
          <div className="sm:col-span-4 flex items-center gap-2 mt-1 flex-wrap">
            <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-chat-smile-2-line mr-1"></i> Start Coaching
            </button>
            <Link to={`/coach/case-files`} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-file-chart-line mr-1"></i> View Progress
            </Link>
            <Link to="/coach/messages" className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-mail-line mr-1"></i> Message
            </Link>
            <Link to="/coach/employer-actions" className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-building-2-line mr-1"></i> Contact Employer
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
