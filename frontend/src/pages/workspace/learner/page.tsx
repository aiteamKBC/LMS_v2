import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE, LEARNER_RECENT_FEEDBACK, LEARNER_MESSAGES, WEEKLY_LEARNING_COMPONENTS } from '@/mocks/learner-profile';
import { TRAINING_ACTIVITIES } from '@/mocks/training-plan';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useMyLearner } from '@/hooks/useMyLearner';
import { buildLearnerJourney, quizAggregateStats } from '@/utils/learnerJourney';
import { EmptyState } from '@/pages/users/components/ui';
import type React from 'react';

const learnerNav = roleNavMap.learner;

/* ── type → colour mapping (mirror this-week page) ── */
const typeStyle: Record<string, { bg: string; iconBg: string; iconText: string; chip: string }> = {
  'Live Session': { bg: 'bg-emerald-50/80', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700' },
  'Video': { bg: 'bg-accent-50/80', iconBg: 'bg-accent-100', iconText: 'text-accent-600', chip: 'bg-accent-100 text-accent-700' },
  'Reading': { bg: 'bg-primary-50/80', iconBg: 'bg-primary-100', iconText: 'text-primary-600', chip: 'bg-primary-100 text-primary-700' },
  'Podcast': { bg: 'bg-secondary-50/80', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', chip: 'bg-secondary-100 text-secondary-700' },
  'Quiz': { bg: 'bg-amber-50/80', iconBg: 'bg-amber-100', iconText: 'text-amber-600', chip: 'bg-amber-100 text-amber-700' },
  'Activity': { bg: 'bg-accent-50/80', iconBg: 'bg-accent-100', iconText: 'text-accent-700', chip: 'bg-accent-100 text-accent-700' },
  'Reflection': { bg: 'bg-primary-50/80', iconBg: 'bg-primary-100', iconText: 'text-primary-600', chip: 'bg-primary-100 text-primary-700' },
  'Evidence': { bg: 'bg-secondary-50/80', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', chip: 'bg-secondary-100 text-secondary-700' },
};

const statusStyle: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  'Not Started': { bg: 'bg-background-50', text: 'text-foreground-500', dot: 'bg-foreground-300', border: 'border-foreground-200/60' },
  'In Progress': { bg: 'bg-accent-50/40', text: 'text-accent-800', dot: 'bg-accent-500', border: 'border-accent-300/50' },
  'Evidence Required': { bg: 'bg-amber-50/40', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200/60' },
  'Evidence Submitted': { bg: 'bg-primary-50/40', text: 'text-primary-700', dot: 'bg-primary-500', border: 'border-primary-200/60' },
  'Referred': { bg: 'bg-red-50/40', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200/60' },
  'Completed': { bg: 'bg-emerald-50/40', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200/60' },
};

/* ─────────────────────────────────────────────
   Scroll-triggered reveal component
   ───────────────────────────────────────────── */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setVisible(true), delay);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-[500ms] ease-out ${className} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Tiny SVG Donut Chart
   ───────────────────────────────────────────── */
function DonutRing({ progress, color, size = 40, stroke = 4.5 }: { progress: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(progress, 100) / 100) * circumference;

  const colorMap: Record<string, string> = {
    emerald: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    muted: '#9ca3af',
  };

  const strokeColor = colorMap[color] || '#10b981';

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-foreground-200"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

/* ─────────────────────────────────────────────
   PAGE
   ───────────────────────────────────────────── */
export default function LearnerOverview() {
  const p = LEARNER_PROFILE;

  /* ── Real-learner mode: /workspace/learner/:kind/:id ── */
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const myLearner = useMyLearner();
  const kind = urlKind ?? myLearner?.kind;
  const id = urlId ?? myLearner?.id;
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);

  const heroName = isRealMode ? ((real?.name.split(' ')[0]) || real?.name || 'Learner') : p.firstName;
  const heroFullName = isRealMode ? (real?.name || 'Learner') : p.fullName;
  const heroProgramme = isRealMode ? (real?.programme || '') : p.programme;
  const heroEmployer = isRealMode ? (real?.employer || '') : p.employer;
  const heroCohort = isRealMode ? (real?.cohort || '') : p.cohort;
  const subtitleParts = isRealMode
    ? [heroProgramme, heroEmployer, heroCohort ? `Cohort ${heroCohort}` : ''].filter(Boolean)
    : [`${p.programme} ${p.programmeLevel}`, p.employer, `Cohort ${p.cohort}`];

  /* ── Real learner's training-plan journey, grouped module -> week -> components ── */
  const journey = useMemo(() => (isRealMode ? buildLearnerJourney(real) : []), [isRealMode, real]);
  // Weekly_Quizzes rollup: each quiz's best attempt -> summed chosen time + union of KSBs.
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);

  /* ── Mark-as-complete state for timeline ── */
  const [userCompletions, setUserCompletions] = useState<Record<number, boolean>>({});

  const handleMarkComplete = useCallback((idx: number) => {
    setUserCompletions(prev => ({ ...prev, [idx]: true }));
  }, []);

  /* ── Overdue count ── */
  const overdueCount = useMemo(() =>
    TRAINING_ACTIVITIES.filter(a => a.status === 'overdue' || a.status === 'Referred').length,
  []);

  /* ── Health score ── */
  const kpiBreakdown = useMemo(() => {
    const attendanceScore = Math.round((p.attendanceRate / 100) * 25);
    const otjhScore = Math.round((p.otjhCompleted / p.otjhTarget) * 25);
    const ksbScore = Math.round((p.ksbProgress / 100) * 25);
    const evidenceScore = Math.round(Math.min((p.evidenceValidated / 12) * 25, 25));
    return [
      { label: 'Attendance', score: attendanceScore, max: 25, icon: 'ri-calendar-check-line', progress: p.attendanceRate, detail: `${p.attendanceRate}%` },
      { label: 'OTJ Hours', score: otjhScore, max: 25, icon: 'ri-time-line', progress: Math.round((p.otjhCompleted / p.otjhTarget) * 100), detail: `${p.otjhCompleted}/${p.otjhTarget}` },
      { label: 'KSB Progress', score: ksbScore, max: 25, icon: 'ri-bar-chart-2-line', progress: p.ksbProgress, detail: `${p.ksbValidated}/${p.ksbTotal}` },
      { label: 'Evidence', score: evidenceScore, max: 25, icon: 'ri-folder-check-line', progress: Math.round(Math.min((p.evidenceValidated / 12) * 100, 100)), detail: `${p.evidenceValidated} approved` },
    ];
  }, [p]);

  /* ── Timeline data ── */
  const timelineComponents = useMemo(() => {
    const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const dateLabels = ['9 Jun', '10 Jun', '11 Jun', '12 Jun', '13 Jun'];
    const ids = ['w4-c4', 'w4-c2', 'w4-c1', 'w4-c6', 'w4-c5'];

    return ids.map((id, i) => {
      const comp = WEEKLY_LEARNING_COMPONENTS.find(c => c.id === id);
      if (!comp) return null;
      return {
        ...comp,
        dayLabel: dayOrder[i],
        dateLabel: dateLabels[i],
      };
    }).filter(Boolean);
  }, []);

  /* ── Upcoming events ── */
  const upcomingEvents = [
    { date: '14 Jun', title: 'Workplace Reflection Due', type: 'Evidence', urgent: true, countdown: '2 days', icon: 'ri-folder-check-line' },
    { date: '18 Jun', title: 'Monthly Coaching', type: 'Coaching', urgent: false, countdown: '6 days', icon: 'ri-chat-smile-2-line' },
    { date: '22 Jun', title: 'Portfolio Submission', type: 'Portfolio', urgent: false, countdown: '10 days', icon: 'ri-briefcase-line' },
    { date: '25 Jun', title: 'Progress Review', type: 'Review', urgent: false, countdown: '13 days', icon: 'ri-file-chart-line' },
    { date: '30 Jun', title: 'Checkpoint Assessment', type: 'Assessment', urgent: false, countdown: '18 days', icon: 'ri-clipboard-line' },
  ];

  /* ── Activity feed ── */
  const activityFeed = [
    ...LEARNER_RECENT_FEEDBACK.map(f => ({ ...f, kind: 'feedback' as const })),
    ...LEARNER_MESSAGES.filter(m => m.unread).map(m => ({ ...m, kind: 'message' as const })),
  ].slice(0, 3);

  /* ── Achievements ── */
  const achievements = [
    { icon: 'ri-vip-crown-line', label: 'Gold Club', color: 'accent' as const },
    { icon: 'ri-fire-line', label: '8 Week Streak', color: 'secondary' as const },
    { icon: 'ri-star-line', label: `${p.pointsBalance} Points`, color: 'primary' as const },
    { icon: 'ri-check-double-line', label: `${p.evidenceValidated} Approved`, color: 'emerald' as const },
    { icon: 'ri-medal-line', label: 'Top Performer', color: 'amber' as const },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={isRealMode ? (loading ? 'Loading learner…' : `Good morning, ${heroName}`) : `Good morning, ${p.firstName}`}
      pageSubtitle={isRealMode ? subtitleParts.join(' · ') : `${p.programme} ${p.programmeLevel} · ${p.employer} · Cohort ${p.cohort}`}
      userName={isRealMode ? heroFullName : p.fullName}
      userRole={isRealMode ? (heroProgramme ? `${heroProgramme} Learner` : 'Learner') : `${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ================================================================
            SECTION 1 — HERO BANNER
            ================================================================ */}
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
                alt="Learner"
                className="h-full w-auto object-contain object-bottom"
                style={{ maxHeight: '115%', transform: 'translateY(8%)' }}
              />
            </div>
            <div className="relative h-full flex flex-col justify-center p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                <div className="flex-1 min-w-0 max-w-xl">
                  <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">
                    {isRealMode ? (loading ? 'Loading learner…' : `Good morning, ${heroName}`) : `Good morning, ${p.firstName}`}
                  </h1>
                  <p className="text-[13px] text-white/50 max-w-lg">
                    {isRealMode
                      ? (loadError ? loadError : subtitleParts.join(' · ') || 'No programme details yet')
                      : <>{p.programme} Level {p.programmeLevel} &middot; {p.employer} &middot; Cohort {p.cohort} &middot; Coach: {p.coach.name}</>}
                  </p>
                </div>
              </div>
            </div>
            {/* Roadmap Icon Button — links to the logged-in learner's own journey, not applicable when viewing another learner's read-only profile */}
            {!isRealMode && (
            <a
              href="/learner/modules"
              className="absolute top-4 right-4 lg:top-5 lg:right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-all duration-200 hover:scale-110 cursor-pointer group z-10"
              title="My Learning Journey"
            >
              <i className="ri-route-line text-white/80 text-lg group-hover:text-white transition-colors"></i>
            </a>
            )}
          </section>
        </SectionReveal>

        {/* ================================================================
            SECTION 2 — TODAY'S FOCUS
            ================================================================ */}
        <SectionReveal delay={80}>
          <section className="relative rounded-2xl overflow-hidden bg-background-50 border border-foreground-200/50 card-premium">
            <div className="absolute inset-0 bg-gradient-to-r from-background-100/60 via-transparent to-transparent pointer-events-none" />
            {isRealMode ? (
              <div className="relative p-5 md:p-6 flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-background-100 flex items-center justify-center shrink-0">
                  <i className="ri-presentation-line text-foreground-400 text-2xl"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground-400 uppercase tracking-widest mb-1 font-label">Today&apos;s Focus</p>
                  <h2 className="text-lg md:text-xl font-heading font-bold text-foreground-500 tracking-tight mb-1">Not tracked yet</h2>
                  <p className="text-sm text-foreground-400">Live session scheduling isn&apos;t wired up for this learner yet.</p>
                </div>
              </div>
            ) : (
            <div className="relative p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-accent-500 flex items-center justify-center shrink-0 shadow-sm shadow-accent-500/20">
                <i className="ri-presentation-line text-foreground-950 text-2xl"></i>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-accent-600 uppercase tracking-widest mb-1 font-label">Today&apos;s Focus</p>
                <h2 className="text-lg md:text-xl font-heading font-bold text-foreground-900 tracking-tight mb-1">Live Session: Campaign Targeting</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-foreground-500">
                  <span className="flex items-center gap-1.5">
                    <i className="ri-calendar-line text-accent-500"></i> {p.nextLiveSession.day}
                  </span>
                  <span className="text-foreground-300">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <i className="ri-time-line text-accent-500"></i> {p.nextLiveSession.time}
                  </span>
                  <span className="text-foreground-300">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <i className="ri-hourglass-line text-accent-500"></i> 2.0 OTJ Hours
                  </span>
                </div>
              </div>

              <a
                href="/learner/this-week"
                className="shrink-0 px-6 py-3 rounded-xl bg-accent-500 text-foreground-950 text-sm font-semibold font-label hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 shadow-sm shadow-accent-500/15"
              >
                Join Session <i className="ri-arrow-right-line"></i>
              </a>
            </div>
            )}
          </section>
        </SectionReveal>

        {/* ================================================================
            SECTION 3 — LEARNING HEALTH DASHBOARD (donut charts)
            ================================================================ */}
        <SectionReveal delay={120}>
          <section className="space-y-4">
            <div className="flex items-center justify-between relative">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Learning Health</h2>

              {/* ── View Overdue ── */}
              {!isRealMode && (
              <div className="flex items-center gap-2">
                <a
                  href="/learner/training-plan?highlight=overdue"
                  className="flex items-center gap-1.5 text-sm font-bold text-white whitespace-nowrap transition-smooth px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 shadow-sm shadow-red-500/15"
                >
                  <i className="ri-error-warning-line text-sm"></i>
                  View Overdue
                  <i className="ri-arrow-right-line text-xs"></i>
                </a>
              </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              {isRealMode ? (
                <>
                  <HealthCard icon="ri-calendar-check-line" label="Attendance" value="—" detail="Not tracked yet" status="muted" progress={0} />
                  {quizStats.quizzesTaken > 0 ? (
                    <HealthCard
                      icon="ri-time-line"
                      label="OTJ Hours"
                      value={`${quizStats.totalHours}h`}
                      detail={`From ${quizStats.quizzesTaken} quiz${quizStats.quizzesTaken === 1 ? '' : 'zes'} · ${real?.totalExpectedOtjh ?? 0}h planned`}
                      status="muted"
                      progress={0}
                      badgeLabel="Logged"
                    />
                  ) : (
                    <HealthCard
                      icon="ri-time-line"
                      label="OTJ Hours"
                      value={`${real?.totalExpectedOtjh ?? 0}h`}
                      detail="Planned from saved training plan"
                      status="muted"
                      progress={0}
                      badgeLabel="Planned"
                    />
                  )}
                  {quizStats.quizzesTaken > 0 ? (
                    <HealthCard
                      icon="ri-bar-chart-2-line"
                      label="KSB Progress"
                      value={`${quizStats.ksbCount} evidenced`}
                      detail={`Via quizzes · ${real?.ksbs.length || 0} defined`}
                      status="muted"
                      progress={real?.ksbs.length ? Math.round((quizStats.ksbCount / real.ksbs.length) * 100) : 0}
                      badgeLabel="From quizzes"
                    />
                  ) : (
                    <HealthCard icon="ri-bar-chart-2-line" label="KSB Progress" value={`${real?.ksbs.length || 0} defined`} detail="Validation not tracked yet" status="muted" progress={0} />
                  )}
                  <HealthCard icon="ri-folder-check-line" label="Evidence" value="—" detail="Not tracked yet" status="muted" progress={0} />
                </>
              ) : (
                <>
                  <HealthCard
                    icon="ri-calendar-check-line"
                    label="Attendance"
                    value={`${p.attendanceRate}%`}
                    detail={`${p.sessionsAttended}/${(p.sessionsAttended + p.sessionsMissed)} sessions`}
                    status={p.attendanceRate >= 90 ? 'green' : p.attendanceRate >= 80 ? 'amber' : 'red'}
                    progress={p.attendanceRate}
                    href="/learner/attendance"
                  />
                  <HealthCard
                    icon="ri-time-line"
                    label="OTJ Hours"
                    value={`${p.otjhCompleted} / ${p.otjhTarget}`}
                    detail={`${p.otjhValidated} validated · ${p.otjhPending} pending`}
                    status={p.otjhCompleted / p.otjhTarget >= 0.7 ? 'green' : p.otjhCompleted / p.otjhTarget >= 0.5 ? 'amber' : 'red'}
                    progress={(p.otjhCompleted / p.otjhTarget) * 100}
                    href="/learner/otjh"
                  />
                  <HealthCard
                    icon="ri-bar-chart-2-line"
                    label="KSB Progress"
                    value={`${p.ksbProgress}%`}
                    detail={`${p.ksbValidated} of ${p.ksbTotal} validated`}
                    status={p.ksbProgress >= 50 ? 'green' : p.ksbProgress >= 30 ? 'amber' : 'red'}
                    progress={p.ksbProgress}
                    href="/learner/ksbs"
                  />
                  <HealthCard
                    icon="ri-folder-check-line"
                    label="Evidence"
                    value={`${p.evidenceCount} Submitted`}
                    detail={`${p.evidenceValidated} approved · ${p.evidenceSubmitted} pending`}
                    status="green"
                    progress={Math.min((p.evidenceValidated / 12) * 100, 100)}
                    href="/learner/evidence"
                  />
                </>
              )}
            </div>
          </section>
        </SectionReveal>

        {/* ================================================================
            SECTION 4 — THIS WEEK'S JOURNEY + UPCOMING (two-column)
            ================================================================ */}
        <SectionReveal delay={160}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
            <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4 md:mb-5">
                <h2 className="text-base font-heading font-semibold text-foreground-900">
                  {isRealMode ? 'Training Plan' : "This Week's Learning Journey"}
                </h2>
                {isRealMode && real && journey.length > 0 && (
                <a href={`/learner/training-plan/${kind}/${id}`} className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                  View full plan <i className="ri-arrow-right-line ml-0.5"></i>
                </a>
                )}
                {!isRealMode && (
                <a href="/learner/this-week" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                  View full plan <i className="ri-arrow-right-line ml-0.5"></i>
                </a>
                )}
              </div>

              {isRealMode ? (
                journey.length === 0 ? (
                  <EmptyState text={loading ? 'Loading…' : 'No training plan built for this learner yet.'} />
                ) : (
                  <div className="space-y-3">
                    {journey.map((mod) => (
                      <div key={mod.module} className="rounded-xl border border-foreground-100 p-4">
                        <p className="text-[13px] font-semibold text-foreground-900 inline-flex items-center gap-2">
                          <i className="ri-book-2-line text-primary-600" />{mod.module}
                        </p>
                        {mod.weeks.length === 0 ? (
                          <p className="text-[12px] text-foreground-400 italic mt-1">No weeks added yet</p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {mod.weeks.map((w) => (
                              <li key={w.week} className="text-[12px] text-foreground-700">
                                <span className="font-medium">{w.week}</span>
                                {w.otjh > 0 && <span className="text-foreground-400"> ({w.otjh}h)</span>}
                                {w.components.length > 0 && (
                                  <span className="text-foreground-400"> — {w.components.map((c) => c.title).join(', ')}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : (
              <div className="relative">
                <div className="absolute left-[19px] top-3 bottom-3 w-px bg-background-200" />

                <div className="space-y-0">
                  {timelineComponents.map((comp, i) => {
                    const effectiveStatus = userCompletions[i] ? 'completed' : comp.status;
                    return (
                      <TimelineCard
                        key={comp.id}
                        component={comp}
                        status={effectiveStatus}
                        canMarkComplete={comp.status !== 'completed' && !userCompletions[i]}
                        onMarkComplete={() => handleMarkComplete(i)}
                      />
                    );
                  })}
                </div>
              </div>
              )}
            </div>

            <div className="lg:col-span-1 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">Upcoming</h2>
                {!isRealMode && (
                <a href="/learner/calendar" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                  View Calendar <i className="ri-arrow-right-line ml-0.5"></i>
                </a>
                )}
              </div>

              {isRealMode ? (
                <EmptyState text="Not tracked yet." />
              ) : (
              <div className="space-y-3">
                {upcomingEvents.map((event, i) => (
                  <UpcomingEventCard key={i} {...event} />
                ))}
              </div>
              )}
            </div>
          </div>
        </SectionReveal>

        {/* ================================================================
            SECTION 4b — PROGRAMME KSBs (real learners only)
            ================================================================ */}
        {isRealMode && (
        <SectionReveal delay={180}>
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Programme KSBs</h2>
              <span className="text-xs text-foreground-400">{real?.ksbs.length || 0} total</span>
            </div>
            {!real || real.ksbs.length === 0 ? (
              <EmptyState text={loading ? 'Loading…' : 'No KSBs found for this programme yet.'} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
                {real.ksbs.map((k) => (
                  <div key={k.code} className="rounded-lg border border-foreground-100 p-2.5">
                    <span className="text-xs font-semibold text-primary-600">{k.code}</span>
                    <p className="text-xs text-foreground-600 mt-0.5 line-clamp-3">{k.description}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </SectionReveal>
        )}

        {/* ================================================================
            SECTION 5 — ACTIVITY FEED + ACHIEVEMENTS (two-column)
            ================================================================ */}
        <SectionReveal delay={200}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
            <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">Activity Feed</h2>
                {!isRealMode && (
                <a href="/learner/monthly-coaching" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                  View All Activity <i className="ri-arrow-right-line ml-0.5"></i>
                </a>
                )}
              </div>

              {isRealMode ? (
                <EmptyState text="No activity tracked yet." />
              ) : (
              <div className="space-y-3">
                {activityFeed.map((item, i) => (
                  <ActivityFeedItem key={i} item={item} index={i} />
                ))}
              </div>
              )}
            </div>

            <div className="lg:col-span-1 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-heading font-semibold text-foreground-900">Achievements</h2>
                {!isRealMode && (
                <a href="/learner/rewards" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                  View Rewards <i className="ri-arrow-right-line ml-0.5"></i>
                </a>
                )}
              </div>

              {isRealMode ? (
                <EmptyState text="Points & achievements aren't tracked yet." />
              ) : (
              <div className="space-y-2.5">
                {achievements.map((ach, i) => (
                  <AchievementBadge key={i} {...ach} />
                ))}
              </div>
              )}
            </div>
          </div>
        </SectionReveal>

        {/* ================================================================
            SECTION 6 — SUPPORT PANEL
            ================================================================ */}
        <SectionReveal delay={240}>
          <section className="bg-background-50 rounded-xl border border-foreground-200/50 p-5 md:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                  <i className="ri-customer-service-2-line text-primary-600 text-lg"></i>
                </div>
                <div>
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Need Help?</h2>
                  <p className="text-sm text-foreground-500">
                    {isRealMode
                      ? 'The support team is here to help this learner succeed.'
                      : <>Your coach {p.coach.name} and the support team are here to help you succeed.</>}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <a href="/learner/messages?contact=med-maher" className="px-4 py-2 rounded-lg border border-foreground-200 text-sm font-medium text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-chat-smile-2-line mr-1.5"></i> Contact Coach
                </a>
                <a href="/learner/support?action=new-ticket&category=wellbeing" className="px-4 py-2 rounded-lg border border-foreground-200 text-sm font-medium text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-heart-pulse-line mr-1.5"></i> Wellbeing Support
                </a>
                <a href="/learner/messages?contact=learner-support" className="px-5 py-2 rounded-lg bg-primary-500 text-white text-sm font-semibold font-label hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shadow-sm shadow-primary-500/15">
                  <i className="ri-customer-service-2-line mr-1.5"></i> Talk With Us
                </a>
              </div>
            </div>
          </section>
        </SectionReveal>

      </div>
    </WorkspaceShell>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────────── */

function HealthCard({ icon, label, value, detail, status, progress, href, badgeLabel }: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  status: 'green' | 'amber' | 'red' | 'muted';
  progress: number;
  href?: string;
  badgeLabel?: string;
}) {
  const statusBg = status === 'green' ? 'bg-emerald-50' : status === 'amber' ? 'bg-amber-50' : status === 'red' ? 'bg-red-50' : 'bg-background-100';
  const statusText = status === 'green' ? 'text-emerald-700' : status === 'amber' ? 'text-amber-700' : status === 'red' ? 'text-red-700' : 'text-foreground-400';
  const statusLabel = badgeLabel ?? (status === 'green' ? 'On Track' : status === 'amber' ? 'Needs Attention' : status === 'red' ? 'Action Required' : 'Not Tracked');
  const iconBg = status === 'green' ? 'bg-emerald-100 text-emerald-600' : status === 'amber' ? 'bg-amber-100 text-amber-600' : status === 'red' ? 'bg-red-100 text-red-600' : 'bg-background-100 text-foreground-400';

  const Card = (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 hover:border-primary-300/60 hover:shadow-sm transition-smooth cursor-pointer">
      {/* Top row: icon + status badge */}
      <div className="flex items-center justify-between mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBg} ${statusText}`}>{statusLabel}</span>
      </div>

      {/* Middle: donut + value side by side */}
      <div className="flex items-center gap-3">
        <DonutRing
          progress={progress}
          color={status === 'green' ? 'emerald' : status === 'amber' ? 'amber' : status === 'red' ? 'red' : 'muted'}
          size={42}
          stroke={4.5}
        />
        <div className="min-w-0">
          <p className="text-xs text-foreground-400 mb-0.5">{label}</p>
          <p className="text-lg font-heading font-semibold text-foreground-900 leading-tight">{value}</p>
        </div>
      </div>

      <p className="text-xs text-foreground-400 mt-2">{detail}</p>
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block">
        {Card}
      </a>
    );
  }

  return Card;
}

function TimelineCard({ component, status, canMarkComplete, onMarkComplete }: {
  component: (typeof WEEKLY_LEARNING_COMPONENTS[number]) & { dayLabel: string; dateLabel: string };
  status: string;
  canMarkComplete: boolean;
  onMarkComplete: () => void;
}) {
  const [animating, setAnimating] = useState(false);
  const isCompleted = status === 'completed';
  const isToday = status === 'In Progress';

  const ts = typeStyle[component.type] || typeStyle['Evidence'];
  const ss = statusStyle[status] || statusStyle['Not Started'];

  const handleClick = () => {
    if (!canMarkComplete || animating) return;
    setAnimating(true);
    onMarkComplete();
    setTimeout(() => setAnimating(false), 500);
  };

  return (
    <div className={`relative flex items-start gap-4 py-3 group`}>
      {/* Timeline dot */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }}
        disabled={!canMarkComplete}
        className={`relative z-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-[350ms] ease-out mt-3 ${
          canMarkComplete
            ? 'cursor-pointer hover:scale-125'
            : 'cursor-default'
        }`}
        style={{ width: canMarkComplete ? '22px' : '10px', height: canMarkComplete ? '22px' : '10px' }}
        aria-label={canMarkComplete ? `Mark "${component.title}" as complete` : undefined}
        title={canMarkComplete ? `Mark "${component.title}" as complete` : isCompleted ? 'Completed' : isToday ? 'Today' : 'Upcoming'}
      >
        {isCompleted ? (
          <span className="flex items-center justify-center w-full h-full rounded-full bg-emerald-400 ring-2 ring-emerald-100">
            <i className={`${animating ? 'ri-check-line' : ''} text-white text-[8px]`}></i>
          </span>
        ) : canMarkComplete ? (
          <span className="flex items-center justify-center w-full h-full rounded-full border-2 border-dashed border-accent-400/60 bg-accent-50 group-hover:border-accent-500 group-hover:bg-accent-100 transition-smooth">
            <i className="ri-check-line text-accent-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200"></i>
          </span>
        ) : (
          <span className={`w-[10px] h-[10px] rounded-full block ${
            isToday ? 'bg-accent-500 ring-4 ring-accent-200 animate-pulse-slow' :
            'bg-foreground-200 ring-2 ring-background-100'
          }`} />
        )}
      </button>

      {/* Day label */}
      <div className="text-center shrink-0 w-12 mt-2">
        <p className="text-xs text-foreground-400 uppercase font-semibold tracking-wider">{component.dayLabel}</p>
        <p className="text-xs text-foreground-600 font-medium">{component.dateLabel}</p>
      </div>

      {/* Card content */}
      <a
        href={`/learner/this-week?open=${component.id}`}
        className="flex-1 min-w-0 block"
      >
        <div className={`relative rounded-xl border p-4 transition-smooth card-premium cursor-pointer hover:border-primary-300/60 hover:shadow-sm ${isCompleted ? 'border-foreground-200/50 bg-background-50' : 'border-foreground-200/50 bg-background-50'}`}>
          <div className="flex items-start gap-4">
            {/* Type icon */}
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${ts.iconBg} ${ts.iconText}`}>
              <i className={`${component.typeIcon} text-lg`}></i>
            </div>

            <div className="flex-1 min-w-0">
              {/* Top row: type chip + status */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${ts.chip}`}>{component.type}</span>
                {component.isLive && !isCompleted && (
                  <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                )}
                {component.status === 'In Progress' && !component.isLive && !isCompleted && (
                  <span className="text-xs font-semibold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">Active</span>
                )}
                {isCompleted && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <i className="ri-check-line"></i> Done
                  </span>
                )}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ml-auto ${ss.bg} ${ss.text}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${ss.dot} mr-1 align-middle`}></span>
                  {status}
                </span>
              </div>

              {/* Title */}
              <p className={`text-sm font-semibold mb-2 ${isCompleted ? 'text-foreground-400 line-through' : 'text-foreground-900'}`}>{component.title}</p>

              {/* Compact meta row */}
              <div className="flex items-center gap-x-4 gap-y-1 text-xs text-foreground-400 flex-wrap">
                <span className="flex items-center gap-1"><i className="ri-timer-line"></i> {component.duration}</span>
                <span className="flex items-center gap-1"><i className="ri-time-line"></i> {component.plannedOTJH}h OTJH</span>
                {component.actualOTJH > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <i className="ri-check-line"></i> {component.actualOTJH}h logged
                  </span>
                )}
                <span className="flex items-center gap-1"><i className="ri-calendar-line"></i> {component.dueDate}</span>
                <span className="flex items-center gap-1 text-amber-600"><i className="ri-coin-line"></i> {component.points} pts</span>
              </div>
            </div>

            {/* Arrow */}
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth shrink-0 mt-0.5">
              <i className="ri-arrow-right-line text-sm"></i>
            </div>
          </div>
        </div>
      </a>
    </div>
  );
}

function UpcomingEventCard({ date, title, type, urgent, countdown, icon }: {
  date: string;
  title: string;
  type: string;
  urgent: boolean;
  countdown: string;
  icon: string;
}) {
  return (
    <a href="/learner/calendar" className="block">
      <div className={`flex items-start gap-3 p-3 rounded-lg transition-smooth cursor-pointer relative overflow-hidden ${
        urgent
          ? 'bg-background-50 border border-foreground-200/50'
          : 'hover:bg-background-100 border border-transparent'
      }`}>
        {/* Animated shimmer overlay for urgent items */}
        {urgent && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground-100/30 to-transparent animate-urgent-shimmer pointer-events-none" />
        )}

        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 relative z-[1] ${
          urgent ? 'bg-red-100 text-red-600' :
          type === 'Coaching' ? 'bg-accent-100 text-accent-700' :
          type === 'Review' ? 'bg-primary-100 text-primary-700' :
          type === 'Assessment' ? 'bg-secondary-100 text-secondary-700' :
          'bg-background-100 text-foreground-500'
        }`}>
          <i className={`${icon} text-sm`}></i>
        </div>

        <div className="flex-1 min-w-0 relative z-[1]">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-xs font-semibold uppercase tracking-wider ${
              urgent ? 'text-red-600' : 'text-foreground-400'
            }`}>{date}</span>
            {urgent && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-slow shrink-0"></span>
            )}
          </div>
          <p className="text-sm font-semibold text-foreground-900 leading-snug mb-1">{title}</p>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              urgent ? 'bg-red-100 text-red-600' : 'bg-background-100 text-foreground-500'
            }`}>{type}</span>
            <span className={`text-xs flex items-center gap-1 ${
              urgent ? 'text-red-500 font-semibold animate-countdown-pulse' : 'text-foreground-400'
            }`}>
              <i className={`${urgent ? 'ri-timer-flash-line' : 'ri-timer-line'} text-xs`}></i>
              {countdown}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}

/* ─────────────────────────────────────────────
   ACTIVITY FEED — Professional Item
   ───────────────────────────────────────────── */
function ActivityFeedItem({ item, index }: { item: any; index: number }) {
  const roleTheme: Record<string, { accent: string; iconBg: string; iconText: string; border: string; avatar: string }> = {
    Coach: {
      accent: 'bg-primary-500',
      iconBg: 'bg-primary-100',
      iconText: 'text-primary-700',
      border: 'border-primary-200/40',
      avatar: 'bg-primary-100 text-primary-700',
    },
    Tutor: {
      accent: 'bg-accent-500',
      iconBg: 'bg-accent-100',
      iconText: 'text-accent-700',
      border: 'border-accent-200/40',
      avatar: 'bg-accent-100 text-accent-700',
    },
    'Line Manager': {
      accent: 'bg-emerald-500',
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-700',
      border: 'border-emerald-200/40',
      avatar: 'bg-emerald-100 text-emerald-700',
    },
    message: {
      accent: 'bg-secondary-500',
      iconBg: 'bg-secondary-100',
      iconText: 'text-secondary-700',
      border: 'border-secondary-200/40',
      avatar: 'bg-secondary-100 text-secondary-700',
    },
  };

  const theme = roleTheme[item.role] || roleTheme[item.kind === 'message' ? 'message' : 'Coach'];
  const isUnread = item.kind === 'message';

  return (
    <div className={`relative flex gap-3.5 rounded-xl border border-foreground-200/60 bg-background-50 p-4 hover:border-background-300/70 hover:bg-background-100/50 transition-all duration-300 group`}>
      {/* Left accent bar */}
      <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${theme.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${theme.avatar} ring-2 ring-white shadow-sm`}>
          {isUnread ? (
            <i className={`ri-mail-unread-line ${theme.iconText} text-sm`}></i>
          ) : (
            <span className={`text-sm font-bold ${theme.iconText}`}>{item.from.charAt(0)}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground-900">{item.from}</span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${theme.iconBg} ${theme.iconText}`}>
            {item.role}
          </span>
          {isUnread && (
            <span className="text-[11px] font-bold text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-full border border-secondary-200/40">
              Unread
            </span>
          )}
          <span className="text-xs text-foreground-400 ml-auto whitespace-nowrap">{item.date}</span>
        </div>

        {/* Message text */}
        <p className="text-sm text-foreground-600 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all duration-300">
          {item.text}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ACHIEVEMENTS — Professional Badge
   ───────────────────────────────────────────── */
function AchievementBadge({ icon, label, color }: { icon: string; label: string; color: 'accent' | 'primary' | 'secondary' | 'emerald' | 'amber' }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; text: string; ring: string; gradientFrom: string; gradientTo: string }> = {
    accent: {
      iconBg: 'bg-accent-100',
      iconText: 'text-accent-700',
      text: 'text-accent-900',
      ring: 'ring-accent-200/40',
      gradientFrom: 'from-accent-50/60',
      gradientTo: 'to-accent-50/20',
    },
    primary: {
      iconBg: 'bg-primary-100',
      iconText: 'text-primary-700',
      text: 'text-primary-900',
      ring: 'ring-primary-200/40',
      gradientFrom: 'from-primary-50/60',
      gradientTo: 'to-primary-50/20',
    },
    secondary: {
      iconBg: 'bg-secondary-100',
      iconText: 'text-secondary-700',
      text: 'text-secondary-900',
      ring: 'ring-secondary-200/40',
      gradientFrom: 'from-secondary-50/60',
      gradientTo: 'to-secondary-50/20',
    },
    emerald: {
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-700',
      text: 'text-emerald-900',
      ring: 'ring-emerald-200/40',
      gradientFrom: 'from-emerald-50/60',
      gradientTo: 'to-emerald-50/20',
    },
    amber: {
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-700',
      text: 'text-amber-900',
      ring: 'ring-amber-200/40',
      gradientFrom: 'from-amber-50/60',
      gradientTo: 'to-amber-50/20',
    },
  };
  const c = colorMap[color];

  return (
    <div className={`relative flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-foreground-200 bg-gradient-to-r ${c.gradientFrom} ${c.gradientTo} hover:border-background-300/80 hover:shadow-sm transition-all duration-300 cursor-pointer group overflow-hidden`}>
      {/* Subtle decorative ring behind icon */}
      <span className={`absolute left-3 w-12 h-12 rounded-full ring-1 ${c.ring} opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10`} />

      {/* Icon */}
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.iconBg} ${c.iconText} shrink-0 ring-1 ring-inset ring-white/40 shadow-sm`}>
        <i className={`${icon} text-base`}></i>
      </span>

      {/* Text */}
      <span className={`text-sm font-semibold ${c.text} whitespace-nowrap leading-snug`}>{label}</span>

      {/* Subtle arrow on hover */}
      <i className="ri-arrow-right-s-line text-foreground-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ml-auto text-base"></i>
    </div>
  );
}