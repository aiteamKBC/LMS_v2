import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { statusBadge, riskColor } from './utils';
import PrepareReviewModal from './components/PrepareReviewModal';
import FormHistoryPanel from './components/FormHistoryPanel';

const learnerNav = roleNavMap.learner;

/* ── Config ── */
const priorityConfig: Record<string, string> = {
  high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-primary-100 text-primary-700',
};

/* ═══════════════════════════════════════════════════
   Scroll Reveal
   ═══════════════════════════════════════════════════ */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
    obs.observe(el); return () => obs.disconnect();
  }, [delay]);
  return <div ref={ref} className={`transition-all duration-[500ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>{children}</div>;
}

/* ═══════════════════════════════════════════════════
   Donut Ring
   ═══════════════════════════════════════════════════ */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-background-200' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2; const circ = 2 * Math.PI * r; const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const cm: Record<string, string> = { emerald: 'stroke-emerald-500', amber: 'stroke-amber-500', red: 'stroke-red-500', primary: 'stroke-primary-500' };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${cm[color] || 'stroke-primary-500'} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════
   Progress Bar
   ═══════════════════════════════════════════════════ */
function ProgressBar({ pct, color, height = 3 }: { pct: number; color: string; height?: number }) {
  const bc: Record<string, string> = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', primary: 'bg-primary-500', accent: 'bg-accent-500' };
  return <div className="w-full rounded-full bg-background-200 overflow-hidden" style={{ height }}><div className={`h-full rounded-full transition-all duration-700 ease-out ${bc[color] || 'bg-primary-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>;
}

/* ═══════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════ */
export default function ProgressReviewsPage() {
  const p = LEARNER_PROFILE;
  const d = PROGRESS_REVIEWS_DATA;

  const [wellbeingRequest, setWellbeingRequest] = useState(false);
  const [prepModalOpen, setPrepModalOpen] = useState(false);
  const [prepFormSubmitted, setPrepFormSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [coachNotified, setCoachNotified] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'form-history'>('overview');
  const [showAllActions, setShowAllActions] = useState(false);
  const [activeHistory, setActiveHistory] = useState<string | null>(null);

  const handleOpenPrepForm = () => setPrepModalOpen(true);
  const handleClosePrepForm = () => setPrepModalOpen(false);
  const handleFormSubmitted = (timestamp: string) => { setPrepFormSubmitted(true); setSubmittedAt(timestamp); setCoachNotified(true); };

  const completedActions = d.previousActions.filter(a => a.status === 'complete').length;
  const totalActions = d.previousActions.length;
  const completionPct = Math.round((completedActions / totalActions) * 100);
  const overdueCount = d.previousActions.filter(a => a.status === 'overdue').length;

  const readinessScore = d.readiness.score;
  const heroColor = readinessScore >= 70 ? 'emerald' : readinessScore >= 45 ? 'amber' : 'red';

  const completeCount = d.readiness.itemsComplete;
  const outstandingCount = d.readiness.itemsOutstanding;

  const formatSubmittedAt = () => {
    if (!submittedAt) return '';
    const dt = new Date(submittedAt);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Progress Reviews" pageSubtitle={`Formal review workspace for your apprenticeship journey with ${p.coach.name}`}
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════════════════════════════════════════════
            SECTION 1 — DARK HERO BANNER
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={0}>
          <section className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
              <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
              <div className="absolute animate-liquid-blob-3 opacity-10" style={{ width: '50%', height: '25%', left: '20%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
            </div>

            <div className="relative flex flex-col lg:flex-row items-stretch min-h-[180px]">
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
                    {readinessScore}% Readiness
                  </span>
                </div>
                <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Progress Reviews</h1>
                <p className="text-sm text-white/40 max-w-lg">
                  Formal review meetings between you, your coach {d.nextReview.coach}, and your line manager {d.nextReview.lineManager}. Track your progress, workplace application, KSB development, and Gateway readiness.
                </p>
              </div>

              {/* Right: Donut + Stats */}
              <div className="lg:w-[460px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center">
                <div className="flex items-center gap-6 w-full">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="relative">
                      <DonutRing pct={readinessScore} size={70} stroke={6} color={heroColor} trackClass="text-white/8" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-heading font-bold text-white leading-none">{readinessScore}%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-0.5">Readiness Score</p>
                      <p className="text-base font-heading font-bold text-white">{completeCount}<span className="text-white/30 text-sm font-normal">/{completeCount + outstandingCount}</span></p>
                      <p className="text-[10px] text-white/25 mt-0.5">{outstandingCount} items outstanding</p>
                    </div>
                  </div>

                  <div className="w-px h-14 bg-accent-400/10 shrink-0" />

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div><p className="text-[10px] text-white/35">Reviews Done</p><p className="text-sm font-heading font-bold text-emerald-400">{d.hero.completed}</p></div>
                    <div><p className="text-[10px] text-white/35">Total Planned</p><p className="text-sm font-heading font-bold text-white">{d.hero.totalPlanned}</p></div>
                    <div><p className="text-[10px] text-white/35">Next Review</p><p className="text-sm font-heading font-bold text-primary-300">#{d.hero.currentReviewNumber}</p></div>
                    <div><p className="text-[10px] text-white/35">Days Until</p><p className="text-sm font-heading font-bold text-white">{d.hero.daysUntilReview}</p></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 2 — READINESS BREAKDOWN
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={60}>
          <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Review Readiness Breakdown</h3>
                <p className="text-xs text-foreground-400 mt-0.5">How prepared you are across key review dimensions</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-foreground-500"><span className="font-semibold text-emerald-600">{completeCount}</span> Complete</span>
                <span className="text-foreground-500"><span className="font-semibold text-amber-600">{outstandingCount}</span> Outstanding</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {d.readiness.breakdown.map((item) => {
                const itemPct = Math.round((item.value / item.max) * 100);
                const itemColor = itemPct >= 80 ? 'emerald' : itemPct >= 50 ? 'amber' : 'red';
                return (
                  <div key={item.label} className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-foreground-600">{item.label}</span>
                      <span className="text-xs font-bold text-foreground-900">{item.value}{item.max === 100 ? '%' : ''}<span className="text-foreground-300 font-normal">/{item.max}{item.max === 100 ? '' : ''}</span></span>
                    </div>
                    <ProgressBar pct={itemPct} color={itemColor} height={4} />
                  </div>
                );
              })}
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 3 — NEXT REVIEW CARD + TIMELINE
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={100}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Next Review Card */}
            <div className="lg:col-span-2 bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary-500 flex items-center justify-center shrink-0">
                    <i className="ri-calendar-event-line text-white text-2xl" />
                  </div>
                  <div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(d.nextReview.status)}`}>{d.nextReview.status}</span>
                    <p className="text-sm font-heading font-semibold text-foreground-900 mt-1">{d.nextReview.title}</p>
                    <p className="text-sm text-foreground-600">{d.nextReview.date} · {d.nextReview.time}</p>
                    <div className="flex items-center flex-wrap gap-3 text-xs text-foreground-400 mt-1">
                      <span><i className="ri-user-star-line mr-1" />Coach: {d.nextReview.coach}</span>
                      <span><i className="ri-building-line mr-1" />Manager: {d.nextReview.lineManager}</span>
                      <span><i className="ri-map-pin-line mr-1" />{d.nextReview.location}</span>
                      <span><i className="ri-time-line mr-1" />{d.nextReview.duration}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleOpenPrepForm}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary-500 text-background-50 dark:text-foreground-950 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-edit-line" /> Prepare Meeting
                  </button>
                  <button className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-background-100 text-foreground-700 rounded-lg text-sm font-semibold border border-background-200/50 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-calendar-check-line" /> Add To Calendar
                  </button>
                </div>
              </div>
            </div>

            {/* Timeline Summary */}
            <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Review Timeline</h3>
              <div className="flex items-start gap-0.5 overflow-x-auto pb-1">
                {d.timeline.map((rev, idx) => {
                  const isLast = idx === d.timeline.length - 1;
                  const icon = rev.status === 'completed' ? 'ri-check-line' : rev.status === 'current' ? 'ri-arrow-right-s-line' : rev.status === 'gateway' ? 'ri-flag-line' : 'ri-circle-line';
                  const bg = rev.status === 'completed' ? 'bg-emerald-500' : rev.status === 'current' ? 'bg-primary-500' : rev.status === 'gateway' ? 'bg-accent-500' : 'bg-foreground-200';
                  const textClr = rev.status === 'completed' ? 'text-emerald-600' : rev.status === 'current' ? 'text-primary-600' : rev.status === 'gateway' ? 'text-accent-600' : 'text-foreground-400';
                  return (
                    <div key={rev.id} className="flex flex-col items-center min-w-[56px] flex-1">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs mb-1.5 ${bg}`}><i className={icon} /></div>
                      <p className="text-[10px] font-semibold text-foreground-900 text-center leading-tight">{rev.status === 'gateway' ? 'Gateway' : `R${rev.number}`}</p>
                      <p className={`text-[9px] font-medium text-center mt-0.5 ${textClr}`}>
                        {rev.status === 'completed' ? 'Done' : rev.status === 'current' ? 'Upcoming' : rev.status === 'gateway' ? 'Gateway' : 'Scheduled'}
                      </p>
                      <p className="text-[9px] text-foreground-400 text-center mt-0.5">{rev.date}</p>
                      {rev.status === 'completed' && rev.rag && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full mt-1 ${statusBadge(rev.rag)}`}>{rev.rag}</span>
                      )}
                      {!isLast && <div className="w-full h-px bg-background-200 mt-2" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 4 — TAB SWITCHER
            ═══════════════════════════════════════════════════ */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'overview' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('form-history')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'form-history' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
            }`}
          >
            Form History
          </button>
        </div>

        {activeTab === 'overview' && (
          <>
            {/* ═══════════════════════════════════════════════════
                SECTION 5 — REVIEW AREAS DASHBOARD
                ═══════════════════════════════════════════════════ */}
            <SectionReveal delay={140}>
              <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                <div className="mb-4">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Review Areas Dashboard</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Performance snapshot across all review dimensions</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {d.reviewAreas.map((area) => {
                    const r = riskColor(area.risk);
                    return (
                      <div key={area.label} className={`rounded-xl border ${r.border} bg-background-100 p-4 transition-all hover:bg-background-200/70`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${r.dot}`} />
                          <span className="text-[10px] font-medium text-foreground-400 uppercase tracking-wider">{area.label}</span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-lg font-heading font-bold text-foreground-950">{area.value}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadge(area.status)}`}>{area.status}</span>
                        </div>
                        <p className="text-xs text-foreground-400">{area.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            </SectionReveal>

            {/* ═══════════════════════════════════════════════════
                SECTION 6 — PREPARE + SIDEBAR (2-COL)
                ═══════════════════════════════════════════════════ */}
            <SectionReveal delay={180}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
                <div className="lg:col-span-2 space-y-5 md:space-y-6">
                  {/* ── Prepare For Review ── */}
                  <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <i className="ri-draft-line text-primary-600 text-lg" />
                        </div>
                        <div>
                          <h3 className="text-sm font-heading font-semibold text-foreground-900">Prepare For My Review</h3>
                          <p className="text-xs text-foreground-500 mt-0.5">
                            Complete your pre-review reflection to help your coach understand your progress, challenges, and goals before the meeting.
                          </p>
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <span className="text-xs text-foreground-500">
                              <strong className="text-foreground-800">{d.prepQuestions.length}</strong> questions
                            </span>
                            {prepFormSubmitted ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                <i className="ri-check-double-line text-xs" /> Responses Saved
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                <i className="ri-error-warning-line text-xs" /> Not Yet Completed
                              </span>
                            )}
                            {coachNotified && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full">
                                <i className="ri-mail-send-line text-xs" /> Coach Notified
                              </span>
                            )}
                            {submittedAt && (
                              <span className="inline-flex items-center gap-1 text-xs text-foreground-500">
                                <i className="ri-time-line text-xs" /> {formatSubmittedAt()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleOpenPrepForm}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-background-50 dark:text-foreground-950 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <i className={prepFormSubmitted ? 'ri-edit-line' : 'ri-draft-line'} />
                        {prepFormSubmitted ? 'Edit Responses' : 'Start Review Preparation'}
                      </button>
                    </div>
                    <div className="mt-4 pt-4 border-t border-background-200/30">
                      <p className="text-xs font-medium text-foreground-400 mb-2 uppercase tracking-wide">Questions you will answer</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {d.prepQuestions.map((q, idx) => (
                          <div key={q.id} className="flex items-start gap-2">
                            <span className="text-xs font-bold text-primary-500 w-5 flex-shrink-0">{idx + 1}.</span>
                            <span className="text-xs text-foreground-600 leading-relaxed">{q.question}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  {/* ── Previous Action Tracker ── */}
                  <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-heading font-semibold text-foreground-900">Previous Action Tracker</h3>
                        <p className="text-xs text-foreground-400 mt-0.5">Actions agreed in your last review</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-foreground-500">{completionPct}% Complete</span>
                        {overdueCount > 0 && (
                          <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">{overdueCount} Overdue</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {(showAllActions ? d.previousActions : d.previousActions.slice(0, 4)).map((act) => (
                        <div key={act.id} className="flex items-center gap-3 rounded-lg border border-background-200/30 bg-background-100 px-4 py-3 hover:bg-background-200/50 transition-smooth">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${act.status === 'complete' ? 'bg-emerald-400' : act.status === 'in-progress' ? 'bg-primary-400' : act.status === 'overdue' ? 'bg-red-400' : 'bg-foreground-300'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground-900 truncate">{act.title}</p>
                            <p className="text-xs text-foreground-400">Due: {act.dueDate}{act.completedDate ? ` · Completed: ${act.completedDate}` : ''}</p>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadge(act.status.replace('-', ' '))}`}>
                            {act.status.replace('-', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                    {d.previousActions.length > 4 && (
                      <button onClick={() => setShowAllActions(!showAllActions)} className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                        {showAllActions ? 'Show Less' : `Show All ${d.previousActions.length} Actions`}
                      </button>
                    )}
                  </section>
                </div>

                {/* Sidebar */}
                <div className="space-y-5 md:space-y-6">
                  {/* SMART Summary */}
                  <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">SMART Review Summary</h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Learning Completed', value: `${d.smartSummary.learningCompleted} items` },
                        { label: 'Assignments Submitted', value: String(d.smartSummary.assignmentsSubmitted) },
                        { label: 'Evidence Uploaded', value: `${d.smartSummary.evidenceUploaded} items` },
                        { label: 'OTJH Progress', value: `${d.smartSummary.otjhProgress} / ${d.smartSummary.otjhTarget} hrs` },
                        { label: 'KSB Progress', value: `${d.smartSummary.ksbProgress}%` },
                        { label: 'Attendance', value: `${d.smartSummary.attendance}%` },
                        { label: 'Quiz Results', value: `${d.smartSummary.quizResults}% avg` },
                        { label: 'Coaching Activity', value: `${d.smartSummary.coachingActivity} sessions` },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-sm">
                          <span className="text-foreground-600">{item.label}</span>
                          <span className="font-semibold text-foreground-900">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Employer Readiness */}
                  <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Employer Readiness</h3>
                    <div className="space-y-2">
                      {[
                        { label: 'Employer Invitation Sent', done: d.employerReadiness.invitationSent },
                        { label: 'Employer Attendance Confirmed', done: d.employerReadiness.attendanceConfirmed },
                        { label: 'Employer Feedback Submitted', done: d.employerReadiness.feedbackSubmitted },
                        { label: 'Workplace Comments Provided', done: d.employerReadiness.workplaceComments },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-sm">
                          <span className="text-foreground-600">{item.label}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
                            {item.done ? 'Complete' : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Employer Contribution */}
                  <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Employer Contribution</h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Workplace Application', value: d.employerContribution.workplaceApplication },
                        { label: 'Performance', value: d.employerContribution.performance },
                        { label: 'Support Needed', value: d.employerContribution.supportNeeded },
                        { label: 'Manager Comments', value: d.employerContribution.managerComments },
                        { label: 'Employer Feedback', value: d.employerContribution.employerFeedback },
                      ].map((item) => (
                        <div key={item.label}>
                          <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">{item.label}</p>
                          <p className="text-sm text-foreground-700 leading-relaxed">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </SectionReveal>

            {/* ═══════════════════════════════════════════════════
                SECTION 7 — SAFEGUARDING
                ═══════════════════════════════════════════════════ */}
            <SectionReveal delay={220}>
              <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Safeguarding &amp; Wellbeing</h3>
                    <p className="text-xs text-foreground-400 mt-0.5">Your wellbeing is our priority — all requests are confidential</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusBadge(d.safeguarding.status)}`}>{d.safeguarding.status}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                    <p className="text-xs text-foreground-400 mb-0.5">Current Status</p>
                    <p className="text-sm font-semibold text-foreground-900">{d.safeguarding.status}</p>
                  </div>
                  <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                    <p className="text-xs text-foreground-400 mb-0.5">Support Requested</p>
                    <p className="text-sm font-semibold text-foreground-900">{d.safeguarding.supportRequested ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                    <p className="text-xs text-foreground-400 mb-0.5">Wellbeing Check</p>
                    <p className="text-sm font-semibold text-foreground-900">{d.safeguarding.wellbeingCheck}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setWellbeingRequest(!wellbeingRequest)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all whitespace-nowrap ${
                      wellbeingRequest ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-background-100 text-foreground-700 border border-background-200/50 hover:bg-background-200'
                    }`}
                  >
                    <i className="ri-heart-pulse-line" /> {wellbeingRequest ? 'Support Requested' : 'Request Confidential Support'}
                  </button>
                  <p className="text-xs text-foreground-400">
                    <i className="ri-shield-check-line mr-1" /> All requests are handled confidentially by your coaching team.
                  </p>
                </div>
              </section>
            </SectionReveal>

            {/* ═══════════════════════════════════════════════════
                SECTION 8 — COACH SUMMARY + OUTCOME + HISTORY
                ═══════════════════════════════════════════════════ */}
            <SectionReveal delay={260}>
              <div className="space-y-5 md:space-y-6">
                {/* Coach Summary */}
                <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Coach Summary</h3>
                    <p className="text-xs text-foreground-400 mt-0.5">Latest feedback from your coach {d.nextReview.coach}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Strengths</p>
                      <ul className="space-y-1">
                        {d.coachSummary.strengths.map((s, i) => (
                          <li key={i} className="text-sm text-foreground-700 flex items-center gap-2">
                            <i className="ri-check-line text-emerald-500 shrink-0" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Areas For Development</p>
                      <ul className="space-y-1">
                        {d.coachSummary.areasForDevelopment.map((s, i) => (
                          <li key={i} className="text-sm text-foreground-700 flex items-center gap-2">
                            <i className="ri-arrow-up-line text-primary-500 shrink-0" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Recommended Focus</p>
                      <p className="text-sm text-foreground-700">{d.coachSummary.recommendedFocus}</p>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Evidence Quality</p>
                      <p className="text-sm text-foreground-700">{d.coachSummary.evidenceQuality}</p>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">KSB Gaps</p>
                      <ul className="space-y-1">
                        {d.coachSummary.ksbGaps.map((s, i) => (
                          <li key={i} className="text-sm text-foreground-700 flex items-center gap-2">
                            <i className="ri-error-warning-line text-amber-500 shrink-0" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">OTJH Review</p>
                      <p className="text-sm text-foreground-700">{d.coachSummary.otjhReview}</p>
                    </div>
                  </div>
                </section>

                {/* Last Review Outcome */}
                <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Last Review Outcome</h3>
                    <p className="text-xs text-foreground-400 mt-0.5">Summary from your most recent completed review</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                      <p className="text-xs text-foreground-400 mb-0.5">Review Date</p>
                      <p className="text-sm font-semibold text-foreground-900">{d.reviewOutcome.reviewDate}</p>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                      <p className="text-xs text-foreground-400 mb-0.5">RAG Rating</p>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusBadge(d.reviewOutcome.rag)}`}>{d.reviewOutcome.rag}</span>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                      <p className="text-xs text-foreground-400 mb-0.5">Actions Agreed</p>
                      <p className="text-sm font-semibold text-foreground-900">{d.reviewOutcome.actionsAgreed}</p>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-3">
                      <p className="text-xs text-foreground-400 mb-0.5">Next Review</p>
                      <p className="text-sm font-semibold text-foreground-900">{d.reviewOutcome.nextReviewDate}</p>
                    </div>
                  </div>
                  <div className="bg-background-100 rounded-lg border border-background-200/40 p-4 mb-3">
                    <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Summary</p>
                    <p className="text-sm text-foreground-700 leading-relaxed">{d.reviewOutcome.summary}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Coach Comments</p>
                      <p className="text-sm text-foreground-700 leading-relaxed">{d.reviewOutcome.coachComments}</p>
                    </div>
                    <div className="bg-background-100 rounded-lg border border-background-200/40 p-4">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Employer Feedback</p>
                      <p className="text-sm text-foreground-700 leading-relaxed">{d.reviewOutcome.employerFeedback}</p>
                    </div>
                  </div>
                </section>

                {/* Review History Table */}
                <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
                  <div className="p-5 md:p-6 border-b border-background-200/30">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Review History</h3>
                    <p className="text-xs text-foreground-400 mt-0.5">Complete record of all formal progress reviews</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-background-200/40 bg-background-100/50">
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Review</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Date</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Coach</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Employer</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">RAG</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Attendance</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">OTJH</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Evidence</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Actions</th>
                          <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.reviewHistory.map((rev) => (
                          <tr key={rev.id} className="border-b border-background-100/80 hover:bg-background-50/60 transition-smooth cursor-pointer" onClick={() => setActiveHistory(activeHistory === rev.id ? null : rev.id)}>
                            <td className="px-5 py-3 text-sm font-bold text-foreground-900">#{rev.number}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.date}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.coach}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.employer}</td>
                            <td className="px-5 py-3"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadge(rev.rag)}`}>{rev.rag}</span></td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.attendance}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.otjh}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.evidence}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600">{rev.actions}</td>
                            <td className="px-5 py-3 text-sm text-foreground-600 max-w-[200px] truncate">{rev.outcome}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {activeHistory && (
                    <div className="p-4 bg-background-100 border-t border-background-200/30">
                      {d.reviewHistory.filter(r => r.id === activeHistory).map(r => (
                        <div key={r.id} className="text-sm text-foreground-700">
                          <strong className="text-foreground-900">Review #{r.number} — {r.date}:</strong> {r.outcome}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </SectionReveal>

            {/* ═══════════════════════════════════════════════════
                SECTION 9 — GATEWAY IMPACT + NEXT BEST ACTIONS
                ═══════════════════════════════════════════════════ */}
            <SectionReveal delay={300}>
              <div className="space-y-5 md:space-y-6">
                {/* Gateway Impact */}
                <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Gateway Impact</h3>
                    <p className="text-xs text-foreground-400 mt-0.5">How progress reviews contribute to your Gateway readiness</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                    {[
                      d.gatewayImpact.ksbValidation,
                      d.gatewayImpact.evidenceCoverage,
                      d.gatewayImpact.otjhProgress,
                      d.gatewayImpact.employerEngagement,
                      d.gatewayImpact.assessmentReadiness,
                    ].map((item) => (
                      <div key={item.label} className="bg-background-100 rounded-lg border border-background-200/40 p-4 text-center">
                        <div className="text-xl font-heading font-bold text-foreground-900">
                          {item.current}<span className="text-sm text-foreground-300 font-normal">/{item.total}</span>
                        </div>
                        <div className="text-xs text-foreground-400 mt-1">{item.label}</div>
                        <div className="mt-2">
                          <ProgressBar pct={Math.round((item.current / item.total) * 100)} color="primary" height={3} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-primary-500/5 border border-primary-500/10 rounded-lg p-4">
                    <p className="text-sm font-semibold text-primary-700">
                      <i className="ri-flag-line mr-1" /> {d.gatewayImpact.contribution}
                    </p>
                  </div>
                </section>

                {/* Next Best Actions */}
                <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Next Best Actions</h3>
                    <p className="text-xs text-foreground-400 mt-0.5">Prioritised actions to improve your review outcomes</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {d.nextBestActions.map((action) => (
                      <div key={action.id} className="flex items-center gap-3 bg-background-100 rounded-lg border border-background-200/40 p-4 hover:bg-background-200/70 transition-smooth cursor-pointer group">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          action.priority === 'high' ? 'bg-red-500/10 text-red-500' :
                          action.priority === 'medium' ? 'bg-amber-500/10 text-amber-500' :
                          'bg-primary-500/10 text-primary-500'
                        }`}>
                          <i className={action.icon} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground-900">{action.title}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priorityConfig[action.priority] || 'bg-background-100 text-foreground-500'}`}>{action.priority}</span>
                        </div>
                        <i className="ri-arrow-right-line text-foreground-300 group-hover:text-foreground-600 transition-smooth" />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </SectionReveal>

            {/* ═══════════════════════════════════════════════════
                SECTION 10 — QUICK LINKS
                ═══════════════════════════════════════════════════ */}
            <SectionReveal delay={340}>
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 md:p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-9 h-9 rounded-xl bg-accent-100 flex items-center justify-center shrink-0">
                    <i className="ri-link-m text-accent-600" />
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Related Pages</h3>
                    <p className="text-xs text-foreground-400">Quick access to connected areas of your apprenticeship</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Link to="/learner/ksbs" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                    <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                      <i className="ri-book-open-line text-primary-600 text-sm" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">KSB Progress</p>
                      <p className="text-xs text-foreground-400">Track Knowledge, Skills & Behaviours</p>
                    </div>
                  </Link>
                  <Link to="/learner/otjh" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                    <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
                      <i className="ri-time-line text-accent-600 text-sm" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">OTJH Tracker</p>
                      <p className="text-xs text-foreground-400">Off-the-Job Training Hours</p>
                    </div>
                  </Link>
                  <Link to="/learner/evidence" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                    <span className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                      <i className="ri-upload-cloud-line text-secondary-600 text-sm" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">Evidence Library</p>
                      <p className="text-xs text-foreground-400">Upload and manage evidence</p>
                    </div>
                  </Link>
                  <Link to="/learner/gateway" className="flex items-center gap-3 p-3 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                    <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                      <i className="ri-flag-line text-emerald-600 text-sm" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-smooth">Gateway Readiness</p>
                      <p className="text-xs text-foreground-400">EPA preparation tracker</p>
                    </div>
                  </Link>
                </div>
              </div>
            </SectionReveal>
          </>
        )}

        {activeTab === 'form-history' && (
          <SectionReveal delay={0}>
            <FormHistoryPanel />
          </SectionReveal>
        )}

      </div>

      {/* Prepare Review Form Modal */}
      <PrepareReviewModal open={prepModalOpen} onClose={handleClosePrepForm} onSubmitted={handleFormSubmitted} />
    </WorkspaceShell>
  );
}