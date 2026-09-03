import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { CATCH_UP_QUEUE, CATCH_UP_JOURNEY_STEPS, ATTENDANCE_STATS } from '@/mocks/attendance';
import CatchUpHub from '../attendance/components/CatchUpHub';
import RecordingCatchUpForm from '../attendance/components/RecordingCatchUpForm';

const learnerNav = roleNavMap.learner;

type PanelView = 'recording' | null;

export default function CatchUpPage() {
  const navigate = useNavigate();
  const p = LEARNER_PROFILE;
  const s = ATTENDANCE_STATS;
  const [panelView, setPanelView] = useState<PanelView>(null);

  const outstandingCount = CATCH_UP_QUEUE.outstanding.length;
  const completedCount = CATCH_UP_QUEUE.completed.length;
  const totalCatchups = outstandingCount + completedCount;
  const catchUpPct = totalCatchups > 0 ? Math.round((completedCount / totalCatchups) * 100) : 0;

  const overdueCount = CATCH_UP_QUEUE.outstanding.filter(c => c.status === 'Overdue').length;
  const hasUrgent = overdueCount > 0 || outstandingCount > 0;

  const urgentItem = useMemo(() => CATCH_UP_QUEUE.outstanding.find(c => c.status === 'Overdue') || CATCH_UP_QUEUE.outstanding[0], []);

  const donutCircumference = 2 * Math.PI * 42;
  const donutOffset = donutCircumference - (catchUpPct / 100) * donutCircumference;

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Catch-Up Learning" pageSubtitle="Complete missed sessions, submit evidence, restore your attendance"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-4 md:p-6 space-y-5">

        {/* ── HERO — compact gradient + donut + stats + CTA ── */}
        <section className="learner-super-admin-hero relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-20" style={{ width: '55%', height: '30%', left: '-8%', top: '-12%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.25) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-12" style={{ width: '60%', height: '32%', right: '-12%', top: '18%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.18) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>

          <div className="relative p-5 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center gap-5">
              {/* Left: Icon + Title + Donut */}
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <span className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0">
                  <AppIcon className="ri-timer-flash-line text-white text-xl"></AppIcon>
                </span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-heading font-bold text-white mb-1">Catch-Up Learning Hub</h2>
                  <p className="text-[12px] text-white/75 leading-relaxed max-w-md">
                    Complete your missed learning. Watch recordings, submit reflections, and restore your attendance.
                  </p>
                </div>
                {/* Donut chart */}
                <div className="relative w-[88px] h-[88px] shrink-0 hidden sm:block">
                  <svg width="88" height="88" viewBox="0 0 100 100" className="-rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="oklch(var(--primary-700) / 0.5)" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none"
                      stroke={catchUpPct >= 75 ? 'oklch(var(--accent-400))' : catchUpPct >= 50 ? '#fbbf24' : '#f87171'}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={donutCircumference} strokeDashoffset={donutOffset}
                      style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-lg font-bold text-white leading-none">{catchUpPct}%</span>
                    <span className="text-[9px] text-white/60 leading-tight">Complete</span>
                  </div>
                </div>
              </div>

              {/* Right: Compact stats + CTA */}
              <div className="flex items-center gap-3 shrink-0 flex-wrap">
                <div className="learner-hero-kpi bg-white/12 backdrop-blur-sm rounded-xl px-3.5 py-2.5 text-center min-w-[68px]">
                  <p className={`text-lg font-bold ${outstandingCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{outstandingCount}</p>
                  <p className="text-[10px] text-white/65 uppercase tracking-wide whitespace-nowrap">Outstanding</p>
                </div>
                <div className="learner-hero-kpi bg-white/12 backdrop-blur-sm rounded-xl px-3.5 py-2.5 text-center min-w-[68px]">
                  <p className="text-lg font-bold text-emerald-300">{completedCount}</p>
                  <p className="text-[10px] text-white/65 uppercase tracking-wide whitespace-nowrap">Completed</p>
                </div>
                <div className="learner-hero-kpi bg-white/12 backdrop-blur-sm rounded-xl px-3.5 py-2.5 text-center min-w-[68px]">
                  <p className="text-lg font-bold text-white">{s.currentRate}%</p>
                  <p className="text-[10px] text-white/65 uppercase tracking-wide whitespace-nowrap">Attendance</p>
                </div>
                {hasUrgent && (
                  <button
                    onClick={() => setPanelView('recording')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 hover:scale-105 active:scale-95 transition-all duration-200 whitespace-nowrap cursor-pointer"
                  >
                    <AppIcon className="ri-play-circle-line"></AppIcon> Start Catch-Up
                  </button>
                )}
              </div>
            </div>

            {/* Journey progress bar — compact */}
            <div className="flex items-center gap-1.5 mt-5 pt-4 border-t border-white/10 flex-wrap">
              {CATCH_UP_JOURNEY_STEPS.map((step, i) => (
                <div key={step.step} className="flex items-center gap-1.5">
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-smooth ${
                    step.status === 'completed' ? 'bg-emerald-500/20 text-emerald-200' :
                    step.status === 'in-progress' ? 'bg-amber-500/20 text-amber-200' :
                    'bg-white/5 text-white/35'
                  }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                      step.status === 'completed' ? 'bg-emerald-400 text-white' :
                      step.status === 'in-progress' ? 'bg-amber-400 text-white' :
                      'bg-white/10 text-white/40'
                    }`}>
                      {step.status === 'completed' ? <AppIcon className="ri-check-line"></AppIcon> : step.step}
                    </span>
                    <span className="whitespace-nowrap">{step.label}</span>
                  </div>
                  {i < CATCH_UP_JOURNEY_STEPS.length - 1 && (
                    <AppIcon className="ri-arrow-right-s-line text-white/20 text-[9px]"></AppIcon>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRIORITY ACTION — only if needed ── */}
        {urgentItem && (
          <section className="relative rounded-xl overflow-hidden bg-gradient-to-r from-amber-50 via-amber-50 to-amber-100/40 border border-amber-200/50">
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <span className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
                <AppIcon className="ri-alert-line text-white text-lg"></AppIcon>
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700">Priority Action</span>
                  <span className="text-xs text-foreground-400">Deadline: {urgentItem.deadline}</span>
                </div>
                <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-0.5">{urgentItem.originalSession}</h4>
                <p className="text-xs text-foreground-500">
                  {urgentItem.reason} · Route: {urgentItem.catchUpRoute} · {urgentItem.progress}% complete
                </p>
              </div>
              <button
                onClick={() => setPanelView('recording')}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-primary-500 text-background-50 text-sm font-semibold hover:bg-primary-600 hover:scale-105 active:scale-95 transition-all duration-200 whitespace-nowrap cursor-pointer"
              >
                <AppIcon className="ri-play-circle-line"></AppIcon> Complete Catch-Up
              </button>
            </div>
          </section>
        )}

        {/* ── MAIN CONTENT — CatchUpHub ── */}
        <CatchUpHub onStartCatchUp={() => setPanelView('recording')} />

        {/* ── Compact footer ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-3 border-t border-background-200/40 text-[11px] text-foreground-400">
          <div className="flex items-center gap-1.5">
            <AppIcon className="ri-information-line text-secondary-400"></AppIcon>
            <span>Catch-up must be completed within 7 days. Evidence needs coach approval to restore attendance.</span>
          </div>
          <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
            <AppIcon className="ri-arrow-left-line"></AppIcon> Back to Attendance
          </button>
        </div>

      </div>

      {/* ── Recording Form Slide Panel ── */}
      <RightSlidePanel
        isOpen={panelView === 'recording'}
        onClose={() => setPanelView(null)}
        title="Submit Catch-Up Evidence"
        width="w-[520px]"
      >
        <RecordingCatchUpForm />
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
