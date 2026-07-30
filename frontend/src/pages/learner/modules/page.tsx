import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RealLearningJourneyView } from '@/components/feature/RealLearningJourneyView';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import RoadJourneyView from './components/RoadJourneyView';
import type { RoadModule } from './components/RoadJourneyView';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

/* ═══════════════════════════════════════════════════════════════
   MODULE DATA
   ═══════════════════════════════════════════════════════════════ */
const MODULES: RoadModule[] = [
  {
    id: 'mod-01',
    title: 'Apprenticeship Induction and Professional Practice',
    shortTitle: 'Induction',
    weeks: '1–4',
    weekRange: 'Weeks 1–4',
    progress: 100,
    status: 'Completed',
    tutor: 'Crispin Jones',
    startDate: '19 May 2026',
    endDate: '15 Jun 2026',
    assignments: 2,
    assignmentsCompleted: 2,
    quizzes: 3,
    quizzesPassed: 3,
    evidence: 4,
    evidenceApproved: 4,
    ksbCount: 12,
    ksbsAchieved: 12,
    otjhExpected: 15,
    otjhEarned: 15,
    icon: 'ri-flag-line',
    summary: 'Foundation module covering apprenticeship standards, professional conduct, KBC Academy platform onboarding, and baseline assessments.',
    themes: ['Apprenticeship Standards', 'Platform Onboarding', 'Professional Practice', 'Baseline Assessment'],
  },
  {
    id: 'mod-02',
    title: 'Marketing Principles and Customer Insight',
    shortTitle: 'Principles & Insight',
    weeks: '5–20',
    weekRange: 'Weeks 5–20',
    progress: 25,
    status: 'In Progress',
    tutor: 'Crispin Jones',
    startDate: '16 Jun 2026',
    endDate: '10 Oct 2026',
    assignments: 4,
    assignmentsCompleted: 1,
    quizzes: 8,
    quizzesPassed: 2,
    evidence: 12,
    evidenceApproved: 3,
    ksbCount: 18,
    ksbsAchieved: 4,
    otjhExpected: 45,
    otjhEarned: 12,
    icon: 'ri-lightbulb-line',
    summary: 'Core marketing principles, customer behaviour models, market research methods, segmentation and targeting, and the STP framework.',
    themes: ['Marketing Fundamentals', 'Consumer Behaviour', 'Market Research', 'Segmentation & Targeting'],
  },
  {
    id: 'mod-03',
    title: 'Marketing Planning and Campaign Delivery',
    shortTitle: 'Campaigns',
    weeks: '21–36',
    weekRange: 'Weeks 21–36',
    progress: 0,
    status: 'Upcoming',
    tutor: 'Crispin Jones',
    startDate: '11 Oct 2026',
    endDate: '31 Jan 2027',
    assignments: 5,
    assignmentsCompleted: 0,
    quizzes: 8,
    quizzesPassed: 0,
    evidence: 14,
    evidenceApproved: 0,
    ksbCount: 16,
    ksbsAchieved: 0,
    otjhExpected: 50,
    otjhEarned: 0,
    icon: 'ri-rocket-line',
    summary: 'Integrated campaign planning, marketing mix application, budgeting, creative brief development, and campaign measurement frameworks.',
    themes: ['Campaign Strategy', 'Marketing Mix', 'Budget Planning', 'Campaign Measurement'],
  },
  {
    id: 'mod-04',
    title: 'Digital Marketing Channels',
    shortTitle: 'Digital',
    weeks: '37–48',
    weekRange: 'Weeks 37–48',
    progress: 0,
    status: 'Locked',
    tutor: 'Crispin Jones',
    startDate: '1 Feb 2027',
    endDate: '25 Apr 2027',
    assignments: 4,
    assignmentsCompleted: 0,
    quizzes: 6,
    quizzesPassed: 0,
    evidence: 10,
    evidenceApproved: 0,
    ksbCount: 12,
    ksbsAchieved: 0,
    otjhExpected: 35,
    otjhEarned: 0,
    icon: 'ri-computer-line',
    summary: 'SEO, content marketing, social media strategy, email marketing, paid advertising, and digital analytics.',
    themes: ['SEO & Content', 'Social Media', 'Email Marketing', 'Digital Analytics'],
  },
  {
    id: 'mod-05',
    title: 'Marketing Metrics and Evaluation',
    shortTitle: 'Metrics',
    weeks: '49–58',
    weekRange: 'Weeks 49–58',
    progress: 0,
    status: 'Locked',
    tutor: 'Crispin Jones',
    startDate: '26 Apr 2027',
    endDate: '4 Jul 2027',
    assignments: 3,
    assignmentsCompleted: 0,
    quizzes: 5,
    quizzesPassed: 0,
    evidence: 8,
    evidenceApproved: 0,
    ksbCount: 8,
    ksbsAchieved: 0,
    otjhExpected: 30,
    otjhEarned: 0,
    icon: 'ri-bar-chart-line',
    summary: 'Marketing KPIs, ROI measurement, analytics dashboards, attribution modelling, and data-driven decision making.',
    themes: ['KPIs & Metrics', 'ROI Analysis', 'Attribution', 'Data-Driven Marketing'],
  },
  {
    id: 'mod-06',
    title: 'Stakeholder Communication and Collaboration',
    shortTitle: 'Stakeholders',
    weeks: '59–64',
    weekRange: 'Weeks 59–64',
    progress: 0,
    status: 'Locked',
    tutor: 'Crispin Jones',
    startDate: '5 Jul 2027',
    endDate: '15 Aug 2027',
    assignments: 2,
    assignmentsCompleted: 0,
    quizzes: 3,
    quizzesPassed: 0,
    evidence: 5,
    evidenceApproved: 0,
    ksbCount: 6,
    ksbsAchieved: 0,
    otjhExpected: 20,
    otjhEarned: 0,
    icon: 'ri-team-line',
    summary: 'Stakeholder mapping, presenting marketing data, building business cases, cross-functional collaboration, and professional communication.',
    themes: ['Stakeholder Mapping', 'Business Cases', 'Data Presentation', 'Cross-Functional Work'],
  },
  {
    id: 'mod-07',
    title: 'Gateway and EPA Preparation',
    shortTitle: 'Gateway',
    weeks: '65–72',
    weekRange: 'Weeks 65–72',
    progress: 0,
    status: 'Gateway',
    tutor: 'Crispin Jones',
    startDate: '16 Aug 2027',
    endDate: '18 Nov 2027',
    assignments: 1,
    assignmentsCompleted: 0,
    quizzes: 2,
    quizzesPassed: 0,
    evidence: 8,
    evidenceApproved: 0,
    ksbCount: 72,
    ksbsAchieved: 0,
    otjhExpected: 15,
    otjhEarned: 0,
    icon: 'ri-shield-check-line',
    summary: 'Portfolio completion, KSB mapping review, professional discussion preparation, mock EPA, and final sign-off.',
    themes: ['Portfolio Completion', 'KSB Mapping', 'Mock EPA', 'Final Sign-Off'],
  },
];

/* ═══════════════════════════════════════════════════════════════
   DERIVED VALUES
   ═══════════════════════════════════════════════════════════════ */
const completedMods = MODULES.filter(m => m.status === 'Completed');
const inProgressMod = MODULES.find(m => m.status === 'In Progress');
const totalModules = MODULES.length;
const totalWeeks = 72;
const currentWeek = 8;

const overallProgress = Math.round(
  MODULES.reduce((sum, m) => sum + m.progress, 0) / totalModules
);

const totalAssignments = MODULES.reduce((s, m) => s + m.assignments, 0);
const completedAssignments = MODULES.reduce((s, m) => s + m.assignmentsCompleted, 0);
const totalQuizzes = MODULES.reduce((s, m) => s + m.quizzes, 0);
const passedQuizzes = MODULES.reduce((s, m) => s + m.quizzesPassed, 0);
const totalEvidence = MODULES.reduce((s, m) => s + m.evidence, 0);
const approvedEvidence = MODULES.reduce((s, m) => s + m.evidenceApproved, 0);
const totalOtjh = MODULES.reduce((s, m) => s + m.otjhExpected, 0);
const earnedOtjh = MODULES.reduce((s, m) => s + m.otjhEarned, 0);

const ksbKnowledgeProgress = 65;
const ksbSkillsProgress = 42;
const ksbBehavioursProgress = 58;
const achievedKsbs = 18;
const totalKsbs = 72;

/* ── Scroll Reveal ── */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (!mounted) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useState(() => { setMounted(true); return null; });
  }
  if (!mounted) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
      obs.observe(el);
      return () => obs.disconnect();
    }, [delay]);
  }
  return (
    <div ref={ref} className={`transition-all duration-[500ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
      {children}
    </div>
  );
}

/* ── Donut Ring ── */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-background-200' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = {
    primary: 'stroke-primary-500', accent: 'stroke-accent-500', secondary: 'stroke-secondary-500',
    emerald: 'stroke-emerald-500', amber: 'stroke-amber-500', red: 'stroke-red-500',
  };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TIMELINE VIEW
   ═══════════════════════════════════════════════════════════════ */
function TimelineView({
  modules,
  currentWeek,
}: {
  modules: RoadModule[];
  currentWeek: number;
}) {
  const totalWeeksT = 72;
  const tickInterval = 4;
  const ticks = Array.from({ length: Math.floor(totalWeeksT / tickInterval) + 1 }, (_, i) => i * tickInterval);

  const barColor = (status: RoadModule['status']) => {
    switch (status) {
      case 'Completed': return 'bg-emerald-400';
      case 'In Progress': return 'bg-primary-400';
      case 'Upcoming': return 'bg-amber-300';
      case 'Locked': return 'bg-foreground-400';
      case 'Gateway': return 'bg-amber-400';
    }
  };

  const getStartWeek = (mod: RoadModule): number => {
    const map: Record<string, number> = {
      'mod-01': 1, 'mod-02': 5, 'mod-03': 21, 'mod-04': 37,
      'mod-05': 49, 'mod-06': 59, 'mod-07': 65,
    };
    return map[mod.id] || 1;
  };

  const getEndWeek = (mod: RoadModule): number => {
    const map: Record<string, number> = {
      'mod-01': 4, 'mod-02': 20, 'mod-03': 36, 'mod-04': 48,
      'mod-05': 58, 'mod-06': 64, 'mod-07': 72,
    };
    return map[mod.id] || 1;
  };

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="relative mb-3">
          <div className="flex items-end h-6">
            <div className="w-[200px] shrink-0 text-[11px] text-foreground-400 font-medium uppercase tracking-wider">Module</div>
            <div className="flex-1 relative">
              <div className="flex">
                {ticks.map(tick => (
                  <div key={tick} className="absolute text-[10px] text-foreground-400" style={{ left: `${(tick / totalWeeksT) * 100}%`, transform: 'translateX(-50%)' }}>
                    W{tick}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative h-3 border-b border-foreground-200">
            {ticks.map(tick => (
              <div key={tick} className="absolute bottom-0 w-px h-2 bg-background-300" style={{ left: `${(tick / totalWeeksT) * 100}%` }}></div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {modules.map(mod => {
            const sw = getStartWeek(mod);
            const ew = getEndWeek(mod);
            const left = ((sw - 1) / totalWeeksT) * 100;
            const width = ((ew - sw + 1) / totalWeeksT) * 100;
            return (
              <div key={mod.id} className="flex items-center gap-3 group">
                <div className="w-[200px] shrink-0 flex items-center gap-2 min-w-0">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-xs ${
                    mod.status === 'Completed' ? 'bg-emerald-100 text-emerald-600' :
                    mod.status === 'In Progress' ? 'bg-primary-100 text-primary-600' :
                    mod.status === 'Gateway' ? 'bg-amber-100 text-amber-600' :
                    'bg-background-100 text-foreground-300'
                  }`}>
                    <i className={`${mod.icon} text-xs`}></i>
                  </span>
                  <span className="text-xs font-medium text-foreground-700 truncate">{mod.shortTitle}</span>
                </div>
                <div className="flex-1 relative h-7 bg-background-100 rounded-md overflow-hidden">
                  <div className={`absolute top-0.5 bottom-0.5 rounded-md ${barColor(mod.status)} flex items-center px-2 text-[11px] font-medium text-white transition-smooth`} style={{ left: `${left}%`, width: `${width}%` }}>
                    <span className="truncate whitespace-nowrap">{mod.status === 'Locked' ? mod.shortTitle : `${mod.shortTitle} (${mod.weeks})`}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative mt-1 h-6">
          <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10" style={{ left: `${((currentWeek - 1) / totalWeeksT) * 100}%` }}>
            <div className="absolute -top-1 -left-3 bg-red-400 text-white text-[9px] font-bold px-1 py-0.5 rounded whitespace-nowrap">Now</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-foreground-200/60">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-400"></span><span className="text-[11px] text-foreground-500">Completed</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary-400"></span><span className="text-[11px] text-foreground-500">In Progress</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-300"></span><span className="text-[11px] text-foreground-500">Upcoming</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-foreground-400"></span><span className="text-[11px] text-foreground-500">Locked</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400"></span><span className="text-[11px] text-foreground-500">Gateway</span></div>
          <div className="flex items-center gap-1.5 ml-auto"><span className="w-px h-3 bg-red-400"></span><span className="text-[11px] text-foreground-500">Current Week ({currentWeek})</span></div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function ModulesPage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);

  const [viewMode, setViewMode] = useState<'road' | 'timeline'>('road');
  const heroColor = overallProgress >= 70 ? 'emerald' : overallProgress >= 45 ? 'amber' : 'red';

  if (isRealMode) {
    return <RealLearningJourneyView real={real} loading={loading} loadError={loadError} learnerKind={kind} learnerId={id} />;
  }

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="My Learning Journey" pageSubtitle={`${p.programme} Level ${p.programmeLevel}`}
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════ DARK HERO BANNER ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            <div className="absolute animate-liquid-blob-3 opacity-10" style={{ width: '50%', height: '25%', left: '20%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
          </div>

          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[170px]">
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">
                  {p.programme} · Level {p.programmeLevel}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  heroColor === 'emerald' ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/20' :
                  heroColor === 'amber' ? 'bg-amber-400/15 text-amber-300 border border-amber-400/20' :
                  'bg-red-400/15 text-red-300 border border-red-400/20'
                }`}>
                  {overallProgress}% Complete
                </span>
              </div>
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">My Learning Journey</h1>
              <p className="text-sm text-white/40 max-w-lg">{totalModules} Modules · {totalWeeks} Weeks · Week {currentWeek} of {totalWeeks} · {completedMods.length} completed, {inProgressMod ? 1 : 0} in progress</p>
            </div>

            <div className="lg:w-[380px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center">
              <div className="flex items-center gap-6 w-full">
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative">
                    <DonutRing pct={overallProgress} size={70} stroke={6} color={heroColor} trackClass="text-white/10" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-heading font-bold text-white leading-none">{overallProgress}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-white/40 mb-0.5">Overall Progress</p>
                    <p className="text-base font-heading font-bold text-white">{completedMods.length}<span className="text-white/30 text-sm font-normal">/{totalModules} modules</span></p>
                  </div>
                </div>
                <div className="w-px h-14 bg-accent-400/10 shrink-0" />
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-lg font-heading font-bold text-emerald-300">{Math.round((currentWeek / totalWeeks) * 100)}%</span>
                    <span className="text-[9px] text-white/40">Week</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-lg font-heading font-bold text-primary-300">{earnedOtjh}</span>
                    <span className="text-[9px] text-white/40">OTJH</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-lg font-heading font-bold text-accent-300">{ksbKnowledgeProgress}%</span>
                    <span className="text-[9px] text-white/40">KSBs</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ VIEW TOGGLE ═══════════ */}
        <div className="flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2 duration-400">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
              <i className="ri-road-map-line text-primary-600 text-sm"></i>
            </span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Your Journey</h3>
              <p className="text-xs text-foreground-400">Where am I? What's next? How far to Gateway?</p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-background-100 rounded-lg border border-foreground-200/60">
            <button
              onClick={() => setViewMode('road')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 ${
                viewMode === 'road' ? 'bg-background-50 text-foreground-900 shadow-sm border border-foreground-200 scale-105' : 'text-foreground-400 hover:text-foreground-600'
              }`}>
              <i className="ri-road-map-line"></i> Road Journey
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap hover:scale-105 active:scale-95 ${
                viewMode === 'timeline' ? 'bg-background-50 text-foreground-900 shadow-sm border border-foreground-200 scale-105' : 'text-foreground-400 hover:text-foreground-600'
              }`}>
              <i className="ri-bar-chart-horizontal-line"></i> Timeline
            </button>
          </div>
        </div>

        {/* ═══════════ MAIN VIEW ═══════════ */}
        {viewMode === 'road' ? (
          <RoadJourneyView
            modules={MODULES}
            currentWeek={currentWeek}
            totalWeeks={totalWeeks}
            overallProgress={overallProgress}
            programme={p.programme}
            programmeLevel={`Level ${p.programmeLevel}`}
            onStationClick={() => {}}
          />
        ) : (
          <div className="animate-in fade-in duration-300">
            <TimelineView modules={MODULES} currentWeek={currentWeek} />
          </div>
        )}

        {/* ═══════════ KSB PROGRESSION ═══════════ */}
        <section className="animate-in slide-in-from-bottom-2 duration-400 delay-200">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center">
              <i className="ri-bar-chart-grouped-line text-secondary-600 text-sm"></i>
            </span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB Progression</h3>
              <p className="text-xs text-foreground-400">{achievedKsbs} of {totalKsbs} KSBs achieved programme-wide</p>
            </div>
          </div>

          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center"><i className="ri-book-open-line text-primary-600 text-xs"></i></span>
                    <span className="text-sm font-semibold text-foreground-900">Knowledge</span>
                  </div>
                  <span className="text-sm font-bold text-primary-600">{ksbKnowledgeProgress}%</span>
                </div>
                <div className="h-2.5 bg-background-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary-400 rounded-full transition-all duration-700 ease-out" style={{ width: `${ksbKnowledgeProgress}%` }}></div>
                </div>
                <p className="text-xs text-foreground-400 mt-1.5">Marketing theory, frameworks, and concepts</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center"><i className="ri-tools-line text-amber-600 text-xs"></i></span>
                    <span className="text-sm font-semibold text-foreground-900">Skills</span>
                  </div>
                  <span className="text-sm font-bold text-amber-600">{ksbSkillsProgress}%</span>
                </div>
                <div className="h-2.5 bg-background-200 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 rounded-full transition-all duration-700 ease-out" style={{ width: `${ksbSkillsProgress}%` }}></div>
                </div>
                <p className="text-xs text-foreground-400 mt-1.5">Practical application and technical abilities</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center"><i className="ri-heart-line text-emerald-600 text-xs"></i></span>
                    <span className="text-sm font-semibold text-foreground-900">Behaviours</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">{ksbBehavioursProgress}%</span>
                </div>
                <div className="h-2.5 bg-background-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all duration-700 ease-out" style={{ width: `${ksbBehavioursProgress}%` }}></div>
                </div>
                <p className="text-xs text-foreground-400 mt-1.5">Professional conduct and workplace behaviours</p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ PROGRAMME STATS GRID ═══════════ */}
        <section className="animate-in slide-in-from-bottom-2 duration-400 delay-300">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center">
              <i className="ri-dashboard-line text-foreground-500 text-sm"></i>
            </span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Programme Statistics</h3>
              <p className="text-xs text-foreground-400">Your progress in numbers</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatBlock label="Assignments" value={`${completedAssignments}/${totalAssignments}`} icon="ri-file-text-line" iconBg="bg-primary-100 text-primary-600" />
            <StatBlock label="Quizzes Passed" value={`${passedQuizzes}/${totalQuizzes}`} icon="ri-questionnaire-line" iconBg="bg-amber-100 text-amber-600" />
            <StatBlock label="Evidence Approved" value={`${approvedEvidence}/${totalEvidence}`} icon="ri-folder-upload-line" iconBg="bg-secondary-100 text-secondary-600" />
            <StatBlock label="OTJH Hours" value={`${earnedOtjh}/${totalOtjh}`} icon="ri-time-line" iconBg="bg-emerald-100 text-emerald-600" />
            <StatBlock label="Attendance" value={`${p.attendanceRate}%`} icon="ri-calendar-check-line" iconBg="bg-amber-100 text-amber-600" />
            <StatBlock label="Overall Progress" value={`${overallProgress}%`} icon="ri-pie-chart-line" iconBg="bg-primary-100 text-primary-600" />
          </div>
        </section>

      </div>
    </WorkspaceShell>
  );
}

function StatBlock({ label, value, icon, iconBg }: { label: string; value: string; icon: string; iconBg: string }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 text-center hover:scale-[1.03] hover:shadow-sm transition-all duration-200">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-2 ${iconBg}`}>
        <i className={icon}></i>
      </span>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-xs text-foreground-400">{label}</p>
    </div>
  );
}
