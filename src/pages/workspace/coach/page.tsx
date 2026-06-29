import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

type ViewMode = 'all' | 'at-risk' | 'high' | 'new';

interface CoachLearner {
  id: string;
  name: string;
  initials: string;
  programme: string;
  employer: string;
  avatar: string;
  status: 'on-track' | 'at-risk' | 'high' | 'new-starter';
  riskFlags: string[];
  overallProgress: number;
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  evidenceCount: number;
  nextCoaching: string;
  nextReview: string;
  lastContact: string;
  recentFlag: string | null;
}

const COACH_LEARNERS: CoachLearner[] = [
  {
    id: 'lrn-001', name: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', avatar: 'S',
    status: 'at-risk', riskFlags: ['Attendance 86% — below 90% target', 'OTJH 74/120 — behind pace', 'KSB 38% — needs evidence focus'],
    overallProgress: 42, attendanceRate: 86, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 38, evidenceCount: 12,
    nextCoaching: '18 Jun 2026', nextReview: '25 Jun 2026', lastContact: '8 Jun 2026', recentFlag: 'OTJH pace concern',
  },
  {
    id: 'lrn-002', name: 'James Okafor', initials: 'JO', programme: 'Marketing Executive L4', employer: 'Pret A Manger', avatar: 'J',
    status: 'on-track', riskFlags: [],
    overallProgress: 48, attendanceRate: 94, otjhCompleted: 82, otjhTarget: 120, ksbProgress: 44, evidenceCount: 15,
    nextCoaching: '19 Jun 2026', nextReview: '26 Jun 2026', lastContact: '7 Jun 2026', recentFlag: null,
  },
  {
    id: 'lrn-004', name: 'Liam Patel', initials: 'LP', programme: 'Data Analyst L4', employer: 'Costa Coffee', avatar: 'L',
    status: 'at-risk', riskFlags: ['Pre-Active — QA Rejected', 'Eligibility unresolved', 'DAS not confirmed'],
    overallProgress: 0, attendanceRate: 0, otjhCompleted: 0, otjhTarget: 120, ksbProgress: 0, evidenceCount: 0,
    nextCoaching: 'On hold', nextReview: 'On hold', lastContact: '3 Jun 2026', recentFlag: 'Compliance block — QA rejection',
  },
  {
    id: 'lrn-007', name: 'Mia Robinson', initials: 'MR', programme: 'Project Manager L4', employer: 'Tesco', avatar: 'M',
    status: 'at-risk', riskFlags: ['Attendance 71% — CRITICAL', '4 consecutive missed sessions', '2 overdue assignments', 'OTJH 28/140 — severely behind'],
    overallProgress: 22, attendanceRate: 71, otjhCompleted: 28, otjhTarget: 140, ksbProgress: 18, evidenceCount: 6,
    nextCoaching: '11 Jun 2026', nextReview: 'Overdue', lastContact: '1 Jun 2026', recentFlag: 'URGENT — welfare concern',
  },
  {
    id: 'lrn-010', name: 'Connor Walsh', initials: 'CW', programme: 'Marketing Executive L4', employer: "Sainsbury's", avatar: 'C',
    status: 'at-risk', riskFlags: ['English FS not yet passed', 'Attendance 89%'],
    overallProgress: 38, attendanceRate: 89, otjhCompleted: 65, otjhTarget: 120, ksbProgress: 32, evidenceCount: 10,
    nextCoaching: '16 Jun 2026', nextReview: '23 Jun 2026', lastContact: '7 Jun 2026', recentFlag: 'FS English pending',
  },
  {
    id: 'lrn-009', name: 'Priya Sharma', initials: 'PS', programme: 'Business Admin L3', employer: 'NatWest Group', avatar: 'P',
    status: 'new-starter', riskFlags: [],
    overallProgress: 10, attendanceRate: 100, otjhCompleted: 14, otjhTarget: 100, ksbProgress: 10, evidenceCount: 3,
    nextCoaching: '17 Jun 2026', nextReview: '24 Jun 2026', lastContact: '9 Jun 2026', recentFlag: 'Week 2 — new start',
  },
];

const COACHING_CALENDAR = [
  { date: '11 Jun', day: 'Wed', time: '15:00–16:00', learner: 'Mia Robinson', type: 'Welfare & Risk Review', status: 'urgent' as const },
  { date: '16 Jun', day: 'Mon', time: '14:00–15:00', learner: 'Connor Walsh', type: 'Monthly Coaching', status: 'confirmed' as const },
  { date: '17 Jun', day: 'Tue', time: '11:00–12:00', learner: 'Priya Sharma', type: 'Onboarding Coaching', status: 'confirmed' as const },
  { date: '18 Jun', day: 'Wed', time: '14:00–15:00', learner: 'Sophie Williams', type: 'Monthly Coaching', status: 'confirmed' as const },
  { date: '19 Jun', day: 'Thu', time: '10:00–11:00', learner: 'James Okafor', type: 'Monthly Coaching', status: 'confirmed' as const },
  { date: '24 Jun', day: 'Tue', time: '10:00–11:00', learner: 'Liam Patel', type: 'Compliance Check-in', status: 'scheduled' as const },
  { date: '25 Jun', day: 'Wed', time: '11:00–12:00', learner: 'Sophie Williams', type: 'Progress Review', status: 'scheduled' as const },
  { date: '26 Jun', day: 'Thu', time: '10:00–11:00', learner: 'James Okafor', type: 'Progress Review', status: 'scheduled' as const },
  { date: '30 Jun', day: 'Mon', time: '15:00–16:00', learner: 'Mia Robinson', type: 'Progress Review (Rescheduled)', status: 'scheduled' as const },
];

const EVIDENCE_QUEUE = [
  { id: 'ev-003', learner: 'Sophie Williams', title: 'STP Model Application — Breakfast Campaign', date: '10 Jun', type: 'Assignment', module: 'Consumer Insight' },
  { id: 'ev-007', learner: 'James Okafor', title: 'Campaign Planning — Autumn Product Launch', date: '08 Jun', type: 'Assignment', module: 'Marketing Planning' },
  { id: 'ev-008', learner: 'Mia Robinson', title: 'Project Initiation Document — Store Renovation', date: '03 Jun', type: 'Workplace Document', module: 'Project Initiation' },
  { id: 'ev-013', learner: 'Emily Chen', title: 'Document Management Process Map', date: '09 Jun', type: 'Workplace Task', module: 'Admin Fundamentals' },
  { id: 'ev-asn', learner: 'Sophie Williams', title: 'Week 3 Assignment — Audience Persona', date: '07 Jun', type: 'Assignment', module: 'Consumer Insight' },
  { id: 'ev-asn2', learner: 'Emily Chen', title: 'Week 1 Assignment — Admin Role Overview', date: '11 Jun', type: 'Assignment', module: 'Admin Fundamentals' },
];

const ABSENCE_REPORTS = [
  { id: 'att-005', learner: 'Mia Robinson', date: '11 Jun 2026', session: 'Week 19 — Risk Management', reason: 'No contact — escalated', status: 'pending' as const },
  { id: 'att-006', learner: 'Mia Robinson', date: '04 Jun 2026', session: 'Week 18 — Project Governance', reason: 'No contact', status: 'pending' as const },
  { id: 'att-003', learner: 'Sophie Williams', date: '28 May 2026', session: 'Week 2 — Consumer Behaviour', reason: 'Work commitment — employer confirmed', status: 'approved' as const },
];

const UPCOMING_SESSIONS = [
  { date: '11 Jun', title: 'Live Session: Customer Segmentation', module: 'Marketing Planning', learners: 18, tutor: 'Crispin Jones', time: '10:00–12:00', platform: 'Teams Live' },
  { date: '12 Jun', title: 'Live Session: Data Visualisation', module: 'Data Analysis', learners: 14, tutor: 'Dr. Helen Park', time: '10:00–12:00', platform: 'Teams Live' },
  { date: '13 Jun', title: 'Live Session: Business Communication', module: 'Business Admin', learners: 22, tutor: 'Rachel Myers', time: '09:00–11:00', platform: 'Teams Live' },
];

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
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [selectedLearner, setSelectedLearner] = useState<CoachLearner | null>(null);

  const filteredLearners = viewMode === 'all'
    ? COACH_LEARNERS
    : COACH_LEARNERS.filter(l => {
        if (viewMode === 'at-risk') return l.status === 'at-risk';
        if (viewMode === 'high') return l.status === 'high';
        if (viewMode === 'new') return l.status === 'new-starter';
        return true;
      });

  const atRiskCount = COACH_LEARNERS.filter(l => l.status === 'at-risk').length;
  const onTrackCount = COACH_LEARNERS.filter(l => l.status === 'on-track').length;
  const highCount = COACH_LEARNERS.filter(l => l.status === 'high').length;
  const newCount = COACH_LEARNERS.filter(l => l.status === 'new-starter').length;
  const pendingEvidence = EVIDENCE_QUEUE.length;
  const pendingAbsence = ABSENCE_REPORTS.filter(a => a.status === 'pending').length;
  const coachingThisWeek = COACHING_CALENDAR.filter(c => ['11 Jun', '12 Jun', '13 Jun', '14 Jun', '15 Jun'].includes(c.date)).length;
  const totalCaseload = COACH_LEARNERS.length;
  const avgAttendance = Math.round(COACH_LEARNERS.reduce((s, l) => s + l.attendanceRate, 0) / totalCaseload);
  const avgProgress = Math.round(COACH_LEARNERS.reduce((s, l) => s + l.overallProgress, 0) / totalCaseload);

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Coach Dashboard" pageSubtitle="Monitor learner progress, manage coaching sessions, and review evidence"
      userName="Med Maher" userRole="Progress Coach"
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
                  <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Good morning, Med</h1>
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
            <StatCard label="At Risk" value={String(atRiskCount)} sub="Needs attention" icon="ri-alert-line" color="red" />
            <StatCard label="High Perf." value={String(highCount)} sub="Exceeding" icon="ri-star-line" color="accent" />
            <StatCard label="Evidence" value={String(pendingEvidence)} sub="Awaiting review" icon="ri-file-search-line" color="secondary" />
            <StatCard label="Absence" value={String(pendingAbsence)} sub="Pending reports" icon="ri-error-warning-line" color="amber" />
            <StatCard label="Reviews" value="4" sub="Next 14 days" icon="ri-file-chart-line" color="primary" />
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 3 — RISK ALERT BANNER
            ═══════════════════════════════════════════════════ */}
        {atRiskCount > 0 && (
          <SectionReveal delay={80}>
            <div className="bg-red-50/70 border border-red-200/50 rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <i className="ri-alert-fill text-red-600 text-base"></i>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Risk Alert: {atRiskCount} learners need immediate attention</p>
                <p className="text-[12px] text-red-600 mt-0.5 truncate">
                  Mia Robinson — CRITICAL: attendance 71%, 4 missed sessions. Liam Patel — QA rejected. Sophie Williams — OTJH pace concern. Connor Walsh — FS English pending.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-[12px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-phone-line mr-1"></i> Call Mia
                </button>
                <Link to="/coach/at-risk" className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] font-medium text-red-700 hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap">
                  View All Risks
                </Link>
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
                    {([{ key: 'all', label: 'All', count: totalCaseload }, { key: 'at-risk', label: 'At Risk', count: atRiskCount }, { key: 'high', label: 'High', count: highCount }, { key: 'new', label: 'New', count: newCount }] as { key: ViewMode; label: string; count: number }[]).map(tab => (
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
                  {UPCOMING_SESSIONS.map(session => (
                    <div key={session.date} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium cursor-pointer">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{session.date}</span>
                        <span className="text-[9px] text-foreground-400">{session.time}</span>
                      </div>
                      <p className="text-[13px] font-semibold text-foreground-900 mb-2 leading-snug">{session.title}</p>
                      <div className="space-y-1 text-[11px] text-foreground-400">
                        <p><i className="ri-stack-line mr-1 text-[10px]"></i> {session.module}</p>
                        <p><i className="ri-user-line mr-1 text-[10px]"></i> {session.learners} learners</p>
                        <p><i className="ri-user-settings-line mr-1 text-[10px]"></i> Tutor: {session.tutor}</p>
                        <p><i className="ri-video-line mr-1 text-[10px]"></i> {session.platform}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </SectionReveal>

            {/* Evidence Queue */}
            <SectionReveal delay={180}>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Evidence Awaiting Review</h2>
                    <p className="text-sm text-foreground-400 mt-0.5">{pendingEvidence} items submitted by your learners</p>
                  </div>
                  <Link to="/coach/evidence-validation" className="text-xs font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                    View All <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                  <div className="divide-y divide-background-200/30">
                    {EVIDENCE_QUEUE.map(item => (
                      <div key={item.id} className="p-3.5 flex items-center gap-4 hover:bg-background-100/50 transition-smooth cursor-pointer">
                        <div className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center shrink-0">
                          <i className="ri-file-text-line text-accent-600 text-sm"></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground-900 truncate">{item.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[11px] text-foreground-500">{item.learner}</span>
                            <span className="text-[8px] text-foreground-300">&middot;</span>
                            <span className="text-[11px] text-foreground-400">{item.module}</span>
                            <span className="text-[8px] text-foreground-300">&middot;</span>
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{item.type}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-foreground-400 shrink-0">{item.date}</span>
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          Review
                        </button>
                      </div>
                    ))}
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
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">June 2026</span>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {COACHING_CALENDAR.map((event, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-3 p-2.5 rounded-lg transition-smooth cursor-pointer ${
                        event.status === 'urgent' ? 'bg-red-50/80 border border-red-200/50' :
                        event.status === 'scheduled' ? 'bg-background-100/50 hover:bg-background-100' :
                        'hover:bg-background-50'
                      }`}
                    >
                      <div className="text-center shrink-0 min-w-[42px]">
                        <p className={`text-[10px] font-semibold uppercase tracking-wider ${event.status === 'urgent' ? 'text-red-600' : 'text-foreground-400'}`}>{event.day}</p>
                        <p className={`text-base font-bold ${event.status === 'urgent' ? 'text-red-700' : 'text-foreground-900'}`}>{event.date.split(' ')[0]}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground-900">{event.learner}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[10px] text-foreground-400">{event.time}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                            event.status === 'urgent' ? 'bg-red-100 text-red-700' :
                            event.status === 'scheduled' ? 'bg-amber-100 text-amber-700' :
                            'bg-primary-100 text-primary-700'
                          }`}>{event.type}</span>
                        </div>
                      </div>
                      <i className={`text-sm shrink-0 ${
                        event.status === 'urgent' ? 'ri-alert-fill text-red-500' :
                        event.status === 'scheduled' ? 'ri-time-line text-amber-500' :
                        'ri-check-line text-emerald-500'
                      }`}></i>
                    </div>
                  ))}
                </div>
              </section>
            </SectionReveal>

            {/* Absence Reports */}
            <SectionReveal delay={160}>
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">
                    Absence Reports
                    <span className="ml-2 text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingAbsence} pending</span>
                  </h3>
                </div>
                <div className="space-y-2">
                  {ABSENCE_REPORTS.map(report => (
                    <div key={report.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-background-100/50 transition-smooth cursor-pointer">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${report.status === 'pending' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        <i className="ri-emotion-sad-line text-sm"></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground-900 truncate">{report.learner}</p>
                        <p className="text-[10px] text-foreground-400 truncate">{report.date} — {report.reason}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${report.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {report.status === 'pending' ? 'Pending' : 'Approved'}
                      </span>
                    </div>
                  ))}
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
                      <strong>OTJH trend alert:</strong> 3 learners trending 15%+ below OTJH pace. Prioritise Sophie Williams, Connor Walsh, and Mia Robinson.
                    </p>
                  </div>
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-[11px] text-foreground-700 leading-relaxed">
                      <strong>Weekly focus:</strong> Prepare for Sophie's coaching session on 18 Jun — discuss OTJH catch-up plan and evidence strategy for KSBs K8-K12.
                    </p>
                  </div>
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-[11px] text-foreground-700 leading-relaxed">
                      <strong>Engagement pattern:</strong> Priya Sharma showing strong onboarding engagement — consider accelerating to independent study mode in Week 4.
                    </p>
                  </div>
                </div>
              </section>
            </SectionReveal>

            {/* Quick Actions */}
            <SectionReveal delay={240}>
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Schedule Coaching', icon: 'ri-calendar-check-line', to: '/coach/meetings' },
                    { label: 'Review Evidence', icon: 'ri-file-search-line', to: '/coach/evidence-validation' },
                    { label: 'Message All', icon: 'ri-mail-send-line', to: '/coach/messages' },
                    { label: 'Run Reports', icon: 'ri-bar-chart-box-line', to: '/coach/reports' },
                    { label: 'Employer Call', icon: 'ri-phone-line', to: '/coach/employer-actions' },
                    { label: 'View Calendar', icon: 'ri-calendar-2-line', to: '/coach/meetings' },
                  ].map(action => (
                    <Link
                      key={action.label}
                      to={action.to}
                      className="flex items-center gap-2 px-3 py-2.5 bg-background-100 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-700 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      <i className={`${action.icon} text-sm`}></i>
                      {action.label}
                    </Link>
                  ))}
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
  const statusConfig: Record<string, { bg: string; text: string; label: string; bar: string }> = {
    'on-track': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'On Track', bar: 'bg-emerald-500' },
    'at-risk': { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700', label: 'At Risk', bar: 'bg-red-500' },
    'high': { bg: 'bg-accent-50 border-accent-200/50', text: 'text-accent-700', label: 'High Performer', bar: 'bg-accent-500' },
    'new-starter': { bg: 'bg-primary-50 border-primary-200/50', text: 'text-primary-700', label: 'New Starter', bar: 'bg-primary-500' },
  };
  const sc = statusConfig[learner.status] || statusConfig['on-track'];

  return (
    <div
      className={`bg-background-50 rounded-xl border p-4 card-premium cursor-pointer transition-smooth ${isSelected ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${learner.status === 'at-risk' ? 'bg-red-100 text-red-700 ring-red-200' : learner.status === 'high' ? 'bg-accent-100 text-accent-700 ring-accent-200' : learner.status === 'new-starter' ? 'bg-primary-100 text-primary-700 ring-primary-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
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
          <span>OTJH: {learner.otjhCompleted}/{learner.otjhTarget}</span>
          <span>KSB: {learner.ksbProgress}%</span>
          <span>Att: {learner.attendanceRate}%</span>
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
              <div className={`h-2 rounded-full transition-smooth ${sc.bar}`} style={{ width: `${learner.overallProgress}%` }}></div>
            </div>
            <p className="text-lg font-bold text-foreground-900">{learner.overallProgress}%</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Attendance</p>
            <p className={`text-lg font-bold ${learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{learner.attendanceRate}%</p>
            <p className="text-[10px] text-foreground-400">{learner.attendanceRate >= 90 ? 'On target' : 'Below 90%'}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Next Coaching</p>
            <p className="text-sm font-semibold text-foreground-900">{learner.nextCoaching}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Evidence</p>
            <p className="text-lg font-bold text-foreground-900">{learner.evidenceCount}</p>
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