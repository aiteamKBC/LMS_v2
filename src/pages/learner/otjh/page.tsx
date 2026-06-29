import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';

const learnerNav = roleNavMap.learner;

/* ── Types ── */
interface OTJHEntry {
  id: string;
  date: string;
  week: string;
  month: string;
  type: string;
  title: string;
  description?: string;
  ksb: string[];
  hours: number;
  status: 'Validated' | 'Pending' | 'Rejected' | 'Evidence Required';
  paid: boolean;
  coach?: string;
  validatedDate?: string;
}

const OTJH_ENTRIES: OTJHEntry[] = [
  { id: 'ot-01', date: '26 Sep 2025', week: 'Week 3', month: 'Sep', type: 'Coaching meeting', title: 'Team 1:1 coaching notes — September', description: 'One-to-one coaching session covering leadership development and stakeholder management strategies', ksb: ['K3', 'S4'], hours: 2.0, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '27 Sep 2025' },
  { id: 'ot-02', date: '03 Oct 2025', week: 'Week 4', month: 'Oct', type: 'Workplace project', title: 'Change communications plan draft', description: 'Drafted a comprehensive communications plan for the upcoming organisational restructure', ksb: ['K4', 'S5'], hours: 1.5, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '04 Oct 2025' },
  { id: 'ot-03', date: '09 Oct 2025', week: 'Week 5', month: 'Oct', type: 'Practical workplace learning', title: 'Stakeholder map — Customer Services restructure', description: 'Mapped all stakeholders and their influence levels for the customer services transformation project', ksb: ['K5'], hours: 2.0, status: 'Pending', paid: true },
  { id: 'ot-04', date: '25 Sep 2025', week: 'Week 3', month: 'Sep', type: 'Reflection', title: 'Reflection: leading a difficult feedback conversation', description: 'Reflected on techniques used during a challenging performance feedback session with a team member', ksb: ['S4', 'B1'], hours: 1.0, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '26 Sep 2025' },
  { id: 'ot-05', date: '11 Sep 2025', week: 'Week 1', month: 'Sep', type: 'Quiz', title: 'Quiz 1 — Leadership models (90%)', description: 'Completed end-of-module assessment on leadership theories and their practical applications', ksb: ['K1'], hours: 0.25, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '12 Sep 2025' },
  { id: 'ot-06', date: '15 Oct 2025', week: 'Week 6', month: 'Oct', type: 'Workplace project', title: 'Project initiation document — draft', description: 'Created the PID outlining scope, objectives, risks and success criteria for the digital transformation initiative', ksb: ['K6', 'S7'], hours: 2.0, status: 'Pending', paid: true },
  { id: 'ot-07', date: '18 Oct 2025', week: 'Week 6', month: 'Oct', type: 'Live session', title: 'Live session: Change management models', description: 'Attended interactive workshop on Kotter and ADKAR change management frameworks', ksb: ['K4', 'S4'], hours: 2.5, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '19 Oct 2025' },
  { id: 'ot-08', date: '22 Oct 2025', week: 'Week 7', month: 'Oct', type: 'Assignment research', title: 'Research: ethical leadership case studies', description: 'Researched 4 case studies on ethical dilemmas in leadership for upcoming assignment', ksb: ['K1', 'B2'], hours: 1.5, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '23 Oct 2025' },
  { id: 'ot-09', date: '28 Oct 2025', week: 'Week 8', month: 'Oct', type: 'Progress review preparation', title: 'Progress review prep: Q2 evidence pack', description: 'Compiled evidence portfolio and self-assessment for the quarterly progress review', ksb: ['K3', 'S5', 'B1'], hours: 1.0, status: 'Evidence Required', paid: true },
  { id: 'ot-10', date: '03 Nov 2025', week: 'Week 9', month: 'Nov', type: 'Live session', title: 'Live session: Operational decision-making', description: 'Participated in group workshop on decision-making frameworks and their application', ksb: ['K2', 'S6'], hours: 2.5, status: 'Pending', paid: true },
  { id: 'ot-11', date: '07 Nov 2025', week: 'Week 10', month: 'Nov', type: 'Reflection', title: 'Reflection: operational decision in practice', description: 'Reflected on a real operational decision made at work and how the frameworks applied', ksb: ['K2', 'B3'], hours: 0.5, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '08 Nov 2025' },
  { id: 'ot-12', date: '12 Nov 2025', week: 'Week 10', month: 'Nov', type: 'Coaching meeting', title: 'Monthly coaching: November check-in', description: 'Monthly coaching session reviewing KSB progress, workplace application and wellbeing', ksb: ['K3', 'S4', 'B4'], hours: 1.0, status: 'Validated', paid: true, coach: 'Med Maher', validatedDate: '12 Nov 2025' },
  { id: 'ot-13', date: '20 Nov 2025', week: 'Week 11', month: 'Nov', type: 'Workplace project', title: 'Team engagement survey — analysis', description: 'Analysed team engagement survey results and prepared recommendations for senior leadership', ksb: ['K6', 'S6', 'S8'], hours: 3.0, status: 'Pending', paid: true },
  { id: 'ot-14', date: '27 Nov 2025', week: 'Week 12', month: 'Nov', type: 'Recorded learning', title: 'Recorded webinar: data-driven leadership', description: 'Watched a 1-hour recorded session on using data analytics to inform leadership decisions', ksb: ['K6'], hours: 1.0, status: 'Rejected', paid: true, coach: 'Med Maher', validatedDate: '28 Nov 2025' },
];

const MONTHLY_TREND = [
  { month: 'May 25', logged: 18, planned: 20, validated: 16 },
  { month: 'Jun 25', logged: 14, planned: 20, validated: 12 },
  { month: 'Jul 25', logged: 8, planned: 20, validated: 6 },
  { month: 'Aug 25', logged: 6, planned: 20, validated: 4 },
  { month: 'Sep 25', logged: 12, planned: 20, validated: 10 },
  { month: 'Oct 25', logged: 16, planned: 20, validated: 14 },
  { month: 'Nov 25', logged: 11, planned: 20, validated: 8 },
];

const ACTIVITY_TYPES = [
  'Live session', 'Recorded learning', 'Assignment research',
  'Workplace project', 'Coaching meeting', 'Progress review preparation',
  'Reflection', 'Practical workplace learning', 'Quiz',
];

const typeConfig: Record<string, { icon: string; bg: string; text: string }> = {
  'Live session': { icon: 'ri-presentation-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  'Recorded learning': { icon: 'ri-video-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  'Assignment research': { icon: 'ri-search-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
  'Workplace project': { icon: 'ri-briefcase-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Coaching meeting': { icon: 'ri-user-star-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  'Progress review preparation': { icon: 'ri-file-list-3-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  Reflection: { icon: 'ri-chat-quote-line', bg: 'bg-amber-100', text: 'text-amber-700' },
  'Practical workplace learning': { icon: 'ri-building-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Quiz: { icon: 'ri-questionnaire-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
  Document: { icon: 'ri-file-text-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  Presentation: { icon: 'ri-slideshow-3-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  Spreadsheet: { icon: 'ri-table-2', bg: 'bg-secondary-100', text: 'text-secondary-700' },
};

const statusConfig: Record<string, { badge: string; dot: string; label: string }> = {
  Validated: { badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', label: 'Validated' },
  Pending: { badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', label: 'Pending' },
  Rejected: { badge: 'bg-red-100 text-red-700', dot: 'bg-red-500', label: 'Rejected' },
  'Evidence Required': { badge: 'bg-primary-100 text-primary-700', dot: 'bg-primary-500', label: 'Evidence Required' },
};

/* ═══════════════════════════════════════════════════
   Scroll Reveal
   ═══════════════════════════════════════════════════ */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } },
      { threshold: 0.06, rootMargin: '0px 0px -20px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return <div ref={ref} className={`transition-all duration-[500ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>{children}</div>;
}

/* ═══════════════════════════════════════════════════
   Donut Ring
   ═══════════════════════════════════════════════════ */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-background-200' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = { emerald: 'stroke-emerald-500', amber: 'stroke-amber-500', red: 'stroke-red-500', primary: 'stroke-primary-500', accent: 'stroke-accent-500' };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || 'stroke-primary-500'} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════
   Progress Bar
   ═══════════════════════════════════════════════════ */
function ProgressBar({ pct, color, height = 3 }: { pct: number; color: string; height?: number }) {
  const barColors: Record<string, string> = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', primary: 'bg-primary-500', accent: 'bg-accent-500', secondary: 'bg-secondary-500' };
  return (
    <div className="w-full rounded-full bg-background-200 overflow-hidden" style={{ height }}>
      <div className={`h-full rounded-full transition-all duration-700 ease-out ${barColors[color] || 'bg-primary-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════ */
export default function OTJHPage() {
  const p = LEARNER_PROFILE;
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'date' | 'hours'>('date');
  const [selectedEntry, setSelectedEntry] = useState<OTJHEntry | null>(null);

  const pct = Math.round((p.otjhCompleted / p.otjhTarget) * 100);
  const totalLogged = OTJH_ENTRIES.reduce((s, e) => s + e.hours, 0);
  const totalValidated = OTJH_ENTRIES.filter(e => e.status === 'Validated').reduce((s, e) => s + e.hours, 0);
  const totalPending = OTJH_ENTRIES.filter(e => e.status === 'Pending' || e.status === 'Evidence Required').reduce((s, e) => s + e.hours, 0);
  const totalRejected = OTJH_ENTRIES.filter(e => e.status === 'Rejected').reduce((s, e) => s + e.hours, 0);

  const thisMonthTrend = MONTHLY_TREND[MONTHLY_TREND.length - 1];
  const isBehind = thisMonthTrend.logged < thisMonthTrend.planned;

  const heroColor = pct >= 70 ? 'emerald' : pct >= 40 ? 'amber' : 'red';

  /* ── Activity type breakdown ── */
  const typeBreakdown = useMemo(() => {
    const typeMap: Record<string, { hours: number; count: number }> = {};
    OTJH_ENTRIES.forEach(e => {
      if (!typeMap[e.type]) typeMap[e.type] = { hours: 0, count: 0 };
      typeMap[e.type].hours += e.hours;
      typeMap[e.type].count += 1;
    });
    return Object.entries(typeMap)
      .map(([type, data]) => ({ type, ...data, pct: Math.round((data.hours / totalLogged) * 100) }))
      .sort((a, b) => b.hours - a.hours);
  }, [totalLogged]);

  /* ── Filtered entries ── */
  const filteredEntries = useMemo(() => {
    let list = [...OTJH_ENTRIES];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => e.title.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || e.ksb.some(k => k.toLowerCase().includes(q)));
    }
    if (filterStatus !== 'All') list = list.filter(e => e.status === filterStatus);
    if (filterType !== 'All') list = list.filter(e => e.type === filterType);
    list.sort((a, b) => sortBy === 'date' ? new Date(b.date).getTime() - new Date(a.date).getTime() : b.hours - a.hours);
    return list;
  }, [searchQuery, filterStatus, filterType, sortBy]);

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="My OTJH" pageSubtitle="Off-the-Job Training — planned vs actual hours"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════════════════════════════════════════════
            SECTION 1 — OTJH HERO BANNER
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={0}>
          <section className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
            {/* Liquid blob decorations */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
              <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
              <div className="absolute animate-liquid-blob-3 opacity-10" style={{ width: '50%', height: '25%', left: '20%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
            </div>

            <div className="relative flex flex-col lg:flex-row items-stretch min-h-[190px]">
              {/* Left: Title + Meta */}
              <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">
                    {p.programme} · {p.programmeLevel}
                  </span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    heroColor === 'emerald' ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/20' :
                    heroColor === 'amber' ? 'bg-amber-400/15 text-amber-300 border border-amber-400/20' :
                    'bg-red-400/15 text-red-300 border border-red-400/20'
                  }`}>
                    {pct}% of {p.otjhTarget}h target
                  </span>
                </div>
                <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Off-the-Job Training Hours</h1>
                <p className="text-sm text-white/40 max-w-lg">
                  Track and log your apprenticeship training hours. All activities must occur during paid working time and be linked to relevant KSBs.
                </p>
              </div>

              {/* Right: Donut + Stats */}
              <div className="lg:w-[420px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center">
                <div className="flex items-center gap-6 w-full">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="relative">
                      <DonutRing pct={pct} size={72} stroke={7} color={heroColor} trackClass="text-white/8" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-heading font-bold text-white leading-none">{pct}%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-0.5">Total Progress</p>
                      <p className="text-base font-heading font-bold text-white">{p.otjhCompleted}h<span className="text-white/30 text-sm font-normal">/{p.otjhTarget}h</span></p>
                      <p className="text-[10px] text-white/25 mt-0.5">{p.otjhTarget - p.otjhCompleted}h remaining</p>
                    </div>
                  </div>
                  <div className="w-px h-14 bg-accent-400/10 shrink-0" />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div><p className="text-[10px] text-white/35">Validated</p><p className="text-sm font-heading font-bold text-emerald-400">{totalValidated}h</p></div>
                    <div><p className="text-[10px] text-white/35">Pending</p><p className="text-sm font-heading font-bold text-amber-400">{totalPending}h</p></div>
                    <div><p className="text-[10px] text-white/35">Rejected</p><p className="text-sm font-heading font-bold text-red-400">{totalRejected}h</p></div>
                    <div><p className="text-[10px] text-white/35">This Month</p><p className="text-sm font-heading font-bold text-white">{thisMonthTrend.logged}h</p></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 2 — STATS OVERVIEW STRIP
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={60}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatsCard label="Target Hours" value={`${p.otjhTarget}h`} sub={`${p.durationMonths}-month programme`} icon="ri-flag-line" color="primary" />
            <StatsCard label="Hours Logged" value={`${totalLogged}h`} sub={isBehind ? 'Behind target' : 'On track'} icon="ri-time-line" color={isBehind ? 'amber' : 'emerald'} />
            <StatsCard label="Validated" value={`${totalValidated}h`} sub={`${OTJH_ENTRIES.filter(e => e.status === 'Validated').length} entries`} icon="ri-check-double-line" color="emerald" />
            <StatsCard label="Pending / Rejected" value={`${totalPending + totalRejected}h`} sub={`${OTJH_ENTRIES.filter(e => e.status !== 'Validated').length} need action`} icon="ri-alert-line" color={totalPending + totalRejected > 5 ? 'red' : 'amber'} />
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 3 — MONTHLY TREND CHART + TYPE BREAKDOWN
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={100}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Monthly Trend Chart */}
            <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Monthly Planned vs Actual</h3>
                <Link to="/learner/progress-reviews" className="text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                  View Progress Reviews <i className="ri-arrow-right-line ml-0.5"></i>
                </Link>
              </div>
              <p className="text-sm text-foreground-400 mb-5">
                Track your OTJH pace — you need ~{(p.otjhTarget / p.durationMonths).toFixed(1)}h per month to stay on target
              </p>

              <div className="flex items-end gap-2 h-44 md:h-48">
                {MONTHLY_TREND.map(m => {
                  const plannedH = Math.round((m.planned / 24) * 100);
                  const loggedH = Math.round((m.logged / 24) * 100);
                  const validatedH = Math.round(((m.validated || 0) / 24) * 100);
                  const gap = m.planned - m.logged;
                  const isBehindMonth = gap > 5;
                  const isCriticalMonth = gap > 10;
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 group">
                      <div className="relative w-full flex items-end gap-[3px] h-36 md:h-40">
                        {/* Planned bar (outline) */}
                        <div className="flex-1 rounded-t-sm border border-dashed border-foreground-200/60 bg-foreground-50/20" style={{ height: `${plannedH}%` }}></div>
                        {/* Logged bar */}
                        <div className={`flex-1 rounded-t-sm transition-all duration-500 ${isCriticalMonth ? 'bg-red-400' : isBehindMonth ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ height: `${loggedH}%` }}></div>
                        {/* Validated overlay */}
                        {m.validated > 0 && (
                          <div className="flex-1 rounded-t-sm bg-emerald-600/80 absolute bottom-0 left-0 w-[calc(50%-1.5px)]" style={{ height: `${validatedH}%` }}></div>
                        )}
                      </div>
                      <span className="text-[10px] text-foreground-400 font-medium">{m.month}</span>
                      <span className={`text-[10px] font-semibold ${isCriticalMonth ? 'text-red-600' : isBehindMonth ? 'text-amber-600' : 'text-emerald-600'}`}>{m.logged}h</span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-center gap-5 mt-5 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-dashed border-foreground-300"></span>Planned (20h)</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-400"></span>Logged</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-600"></span>Validated</span>
              </div>
            </div>

            {/* Activity Type Distribution */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Activity Breakdown</h3>
              <div className="space-y-3">
                {typeBreakdown.slice(0, 7).map(tb => {
                  const tc = typeConfig[tb.type] || { icon: 'ri-file-line', bg: 'bg-background-100', text: 'text-foreground-500' };
                  return (
                    <div key={tb.type} className="flex items-center gap-3">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tc.bg} ${tc.text}`}>
                        <i className={`${tc.icon} text-xs`}></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-foreground-700 truncate">{tb.type}</span>
                          <span className="text-xs font-semibold text-foreground-500 ml-2">{tb.hours}h</span>
                        </div>
                        <ProgressBar pct={tb.pct} color="primary" height={3} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 4 — CATCH-UP ALERT (if behind)
            ═══════════════════════════════════════════════════ */}
        {isBehind && (
          <SectionReveal delay={120}>
            <div className="bg-amber-50/60 border border-amber-200/50 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <span className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <i className="ri-speed-up-line text-amber-600 text-lg"></i>
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-heading font-semibold text-amber-900 mb-1">You are behind on OTJH this month</h3>
                <p className="text-sm text-amber-700">
                  You have logged <strong>{thisMonthTrend.logged}h</strong> out of <strong>{thisMonthTrend.planned}h</strong> planned for {thisMonthTrend.month}.
                  Consider logging workplace activities, coaching sessions, and reflections to catch up.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowForm(true)}
                  className="px-4 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-add-line mr-1"></i> Log Hours Now
                </button>
                <Link
                  to="/learner/evidence"
                  className="px-4 py-2.5 rounded-lg border border-amber-300 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Upload Evidence
                </Link>
              </div>
            </div>
          </SectionReveal>
        )}

        {/* ═══════════════════════════════════════════════════
            SECTION 5 — OTJH ACTIVITY LOG
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={140}>
          <section>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-base font-heading font-semibold text-foreground-900">OTJH Activity Log</h2>
                <p className="text-sm text-foreground-400 mt-0.5">{OTJH_ENTRIES.length} entries — {totalLogged}h total logged across your programme</p>
              </div>
              <button
                onClick={() => setShowForm(!showForm)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <i className="ri-add-line"></i> {showForm ? 'Close Form' : 'Add Entry'}
              </button>
            </div>

            {/* Add Entry Form */}
            {showForm && (
              <div className="mb-4 p-5 bg-background-50 rounded-xl border border-foreground-200/60">
                <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-4">New OTJH Entry</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-foreground-500 mb-1.5">Date</label>
                    <input type="date" className="w-full bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2.5 text-sm text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground-500 mb-1.5">Activity Type</label>
                    <select className="w-full bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2.5 text-sm text-foreground-900 cursor-pointer outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth">
                      {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-foreground-500 mb-1.5">Activity Title</label>
                    <input type="text" className="w-full bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2.5 text-sm text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth" placeholder="What did you do?" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-foreground-500 mb-1.5">Description of Learning</label>
                    <textarea rows={3} maxLength={500} className="w-full bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2.5 text-sm text-foreground-900 resize-none outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth" placeholder="What did you learn? How does this relate to your apprenticeship?" />
                    <p className="text-[10px] text-foreground-300 mt-1">Max 500 characters</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground-500 mb-1.5">Hours Claimed</label>
                    <input type="number" step="0.25" min="0.25" max="8" className="w-full bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2.5 text-sm text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth" placeholder="e.g. 2.5" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground-500 mb-1.5">Linked KSBs</label>
                    <input type="text" className="w-full bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2.5 text-sm text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth" placeholder="e.g. K5, K6, S8" />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <button className="px-5 py-2.5 bg-primary-500 text-background-50 dark:text-foreground-950 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-check-line mr-1"></i> Submit for Validation
                  </button>
                  <button onClick={() => setShowForm(false)} className="px-5 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-sm font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 mb-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                  <input
                    type="text"
                    placeholder="Search by title, type, or KSB code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg bg-background-100 border border-background-200 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth"
                  />
                </div>
                <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
                  {['All', 'Validated', 'Pending', 'Evidence Required', 'Rejected'].map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterStatus === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                      {s === 'All' ? 'All Status' : s}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSortBy(sortBy === 'date' ? 'hours' : 'date')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background-100 text-xs font-semibold text-foreground-500 hover:text-foreground-700 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className={`${sortBy === 'date' ? 'ri-sort-desc' : 'ri-sort-number-desc'} text-sm`}></i>
                  {sortBy === 'date' ? 'By Date' : 'By Hours'}
                </button>
              </div>
              <div className="mt-3 text-xs text-foreground-400">
                Showing {filteredEntries.length} of {OTJH_ENTRIES.length} entries
                {(filterStatus !== 'All' || searchQuery) && (
                  <button onClick={() => { setFilterStatus('All'); setSearchQuery(''); }} className="ml-2 text-primary-600 hover:text-primary-700 font-medium cursor-pointer">
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-foreground-200 bg-background-100/50">
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3">Activity</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-24">Date</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-20">Type</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-20">KSBs</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-16 text-right">Hours</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-24">Paid?</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-28">Status</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry, i) => {
                      const tc = typeConfig[entry.type] || { icon: 'ri-file-line', bg: 'bg-background-100', text: 'text-foreground-500' };
                      const sc = statusConfig[entry.status];
                      return (
                        <tr key={entry.id} className={`border-b border-background-100/80 hover:bg-background-50/60 transition-smooth cursor-pointer ${i % 2 === 0 ? 'bg-transparent' : 'bg-background-50/30'}`} onClick={() => setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tc.bg} ${tc.text}`}>
                                <i className={`${tc.icon} text-sm`}></i>
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground-800 leading-snug truncate max-w-[240px]">{entry.title}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground-500">{entry.date}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-1 rounded-md ${tc.bg} ${tc.text}`}>{entry.type}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {entry.ksb.map(k => (
                                <span key={k} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  k.startsWith('K') ? 'bg-primary-100 text-primary-700' :
                                  k.startsWith('S') ? 'bg-accent-100 text-accent-700' :
                                  'bg-secondary-100 text-secondary-700'
                                }`}>{k}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-sm font-bold ${entry.status === 'Validated' ? 'text-emerald-700' : entry.status === 'Rejected' ? 'text-red-600' : 'text-amber-700'}`}>{entry.hours}h</span>
                          </td>
                          <td className="px-4 py-3">
                            {entry.paid ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
                                <i className="ri-check-line text-[10px]"></i> Paid
                              </span>
                            ) : (
                              <span className="text-xs text-foreground-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${sc.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}></span>
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {selectedEntry?.id === entry.id ? (
                              <i className="ri-arrow-up-s-line text-foreground-400 text-sm"></i>
                            ) : (
                              <i className="ri-arrow-down-s-line text-foreground-400 text-sm"></i>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredEntries.length === 0 && (
                <div className="py-12 text-center">
                  <span className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                    <i className="ri-search-line text-foreground-300 text-xl"></i>
                  </span>
                  <p className="text-sm text-foreground-500">No entries match your filters</p>
                  <button onClick={() => { setFilterStatus('All'); setSearchQuery(''); }} className="mt-2 text-xs font-semibold text-primary-600 hover:text-primary-700 cursor-pointer">
                    Clear all filters
                  </button>
                </div>
              )}
            </div>

            {/* Expanded Entry Details */}
            {selectedEntry && (
              <div className="mt-3 bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-fadeIn">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${(typeConfig[selectedEntry.type] || typeConfig.Document).bg} ${(typeConfig[selectedEntry.type] || typeConfig.Document).text}`}>
                      <i className={`${(typeConfig[selectedEntry.type] || typeConfig.Document).icon} text-lg`}></i>
                    </span>
                    <div>
                      <h4 className="text-sm font-heading font-semibold text-foreground-900">{selectedEntry.title}</h4>
                      <p className="text-xs text-foreground-400 mt-0.5">{selectedEntry.date} · {selectedEntry.week} · {selectedEntry.month}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedEntry(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                    <i className="ri-close-line"></i>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <DetailBlock label="Hours" value={`${selectedEntry.hours}h`} />
                  <DetailBlock label="Status" value={selectedEntry.status} color={selectedEntry.status === 'Validated' ? 'emerald' : selectedEntry.status === 'Rejected' ? 'red' : 'amber'} />
                  <DetailBlock label="Paid Hours" value={selectedEntry.paid ? 'Yes' : 'No'} />
                  <DetailBlock label="Coach" value={selectedEntry.coach || '—'} />
                </div>

                {selectedEntry.description && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1.5">Description</p>
                    <p className="text-sm text-foreground-600 leading-relaxed">{selectedEntry.description}</p>
                  </div>
                )}

                <div className="mb-4">
                  <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1.5">KSBs Covered</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedEntry.ksb.map(k => (
                      <Link
                        key={k}
                        to="/learner/ksbs"
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-smooth hover:opacity-80 ${
                          k.startsWith('K') ? 'bg-primary-100 text-primary-700' :
                          k.startsWith('S') ? 'bg-accent-100 text-accent-700' :
                          'bg-secondary-100 text-secondary-700'
                        }`}
                      >
                        {k}
                      </Link>
                    ))}
                  </div>
                </div>

                {selectedEntry.validatedDate && (
                  <p className="text-xs text-foreground-400">Validated on {selectedEntry.validatedDate} by {selectedEntry.coach}</p>
                )}
              </div>
            )}

            {/* Footer Row */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-background-200/30">
              <div className="flex items-center gap-5 text-sm">
                <span className="text-foreground-400">Validated: <strong className="text-emerald-600">{totalValidated}h</strong></span>
                <span className="text-foreground-400">Pending: <strong className="text-amber-600">{totalPending}h</strong></span>
                {totalRejected > 0 && (
                  <span className="text-foreground-400">Rejected: <strong className="text-red-600">{totalRejected}h</strong></span>
                )}
              </div>
              <button className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground-500 hover:text-foreground-700 cursor-pointer whitespace-nowrap">
                <i className="ri-download-line"></i> Export OTJH Log
              </button>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 6 — OTJH GUIDANCE + POLICY
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={180}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Guidance */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                  <i className="ri-lightbulb-line text-primary-600"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Guidance</h3>
                  <p className="text-xs text-foreground-400">Key principles for logging your hours</p>
                </div>
              </div>
              <div className="space-y-3">
                <GuidanceItem icon="ri-checkbox-circle-line" color="emerald" text="OTJH must happen during your normal paid working hours — this is a funding requirement" />
                <GuidanceItem icon="ri-checkbox-circle-line" color="emerald" text="Always link entries to specific KSB codes for stronger evidence trails" />
                <GuidanceItem icon="ri-checkbox-circle-line" color="emerald" text="Your employer must confirm OTJH is genuine — your coach reviews each entry" />
                <GuidanceItem icon="ri-checkbox-circle-line" color="emerald" text="Live sessions, assignments, coaching meetings and reflections all count as OTJH" />
                <GuidanceItem icon="ri-checkbox-circle-line" color="emerald" text={`You need at least ${p.otjhTarget} hours across your ${p.durationMonths}-month apprenticeship — roughly ${(p.otjhTarget / p.durationMonths).toFixed(1)}h/month`} />
              </div>
            </div>

            {/* Policy & Quick Links */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 md:p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-9 h-9 rounded-xl bg-accent-100 flex items-center justify-center shrink-0">
                  <i className="ri-shield-check-line text-accent-600"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Policy & Quick Links</h3>
                  <p className="text-xs text-foreground-400">Important resources and related pages</p>
                </div>
              </div>
              <div className="space-y-2">
                <Link to="/learner/evidence" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                  <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <i className="ri-upload-cloud-line text-primary-600 text-sm"></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">Upload Evidence</p>
                    <p className="text-xs text-foreground-400">Submit supporting evidence for your OTJH entries</p>
                  </div>
                  <i className="ri-arrow-right-line text-foreground-300 group-hover:text-primary-500 transition-smooth"></i>
                </Link>
                <Link to="/learner/ksbs" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                  <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
                    <i className="ri-book-open-line text-accent-600 text-sm"></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">KSB Progress</p>
                    <p className="text-xs text-foreground-400">Track your Knowledge, Skills & Behaviours development</p>
                  </div>
                  <i className="ri-arrow-right-line text-foreground-300 group-hover:text-primary-500 transition-smooth"></i>
                </Link>
                <Link to="/learner/progress-reviews" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                  <span className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className="ri-file-chart-line text-secondary-600 text-sm"></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">Progress Reviews</p>
                    <p className="text-xs text-foreground-400">View your quarterly review history and OTJH validation status</p>
                  </div>
                  <i className="ri-arrow-right-line text-foreground-300 group-hover:text-primary-500 transition-smooth"></i>
                </Link>
                <Link to="/learner/gateway" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                  <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <i className="ri-flag-line text-emerald-600 text-sm"></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">Gateway Readiness</p>
                    <p className="text-xs text-foreground-400">Check your overall readiness for the Gateway assessment</p>
                  </div>
                  <i className="ri-arrow-right-line text-foreground-300 group-hover:text-primary-500 transition-smooth"></i>
                </Link>
              </div>
            </div>
          </div>
        </SectionReveal>

      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════ */
function StatsCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; accent: string }> = {
    primary: { iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700' },
    emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', accent: 'text-emerald-700' },
    amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700' },
    red: { iconBg: 'bg-red-100', iconText: 'text-red-600', accent: 'text-red-700' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconText}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className="text-xs text-foreground-400 font-medium">{label}</span>
      </div>
      <p className={`text-xl font-heading font-bold ${c.accent} leading-tight`}>{value}</p>
      <p className="text-xs text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}

function DetailBlock({ label, value, color }: { label: string; value: string; color?: string }) {
  const textColor = color === 'emerald' ? 'text-emerald-700' : color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-700' : 'text-foreground-700';
  return (
    <div className="bg-background-100/60 rounded-lg p-3">
      <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${textColor}`}>{value}</p>
    </div>
  );
}

function GuidanceItem({ icon, color, text }: { icon: string; color: string; text: string }) {
  const colorMap: Record<string, string> = { emerald: 'text-emerald-500', primary: 'text-primary-500', accent: 'text-accent-500' };
  return (
    <div className="flex items-start gap-2.5">
      <i className={`${icon} ${colorMap[color] || 'text-emerald-500'} mt-0.5 shrink-0`}></i>
      <span className="text-sm text-foreground-600 leading-relaxed">{text}</span>
    </div>
  );
}