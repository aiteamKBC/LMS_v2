import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import MonthlyReadinessHero from './components/MonthlyReadinessHero';
import CurrentFocusCard from './components/CurrentFocusCard';
import MonthlyJourneyTimeline from './components/MonthlyJourneyTimeline';
import MonthSummaryPanel from './components/MonthSummaryPanel';
import AssignmentProgress from './components/AssignmentProgress';
import CheckpointQuizRules from './components/CheckpointQuizRules';
import CoachingReadinessPanel from './components/CoachingReadinessPanel';
import EndOfMonthOutcome from './components/EndOfMonthOutcome';

const learnerNav = roleNavMap.learner;

export default function MonthlyCyclePage() {
  const p = LEARNER_PROFILE;
  const [activeMonth, setActiveMonth] = useState('jun');

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Monthly Cycle" pageSubtitle="Your apprenticeship monthly rhythm — June 2026"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-6 space-y-6">
        {/* ── Monthly Readiness Score (dynamic per month) ── */}
        <MonthlyReadinessHero month={activeMonth} />

        {/* ── Month Summary Panel (dynamic per month) ── */}
        <MonthSummaryPanel month={activeMonth} />

        {/* ── Current Focus + Next Best Action (dynamic per month) ── */}
        <CurrentFocusCard month={activeMonth} />

        {/* ── Assignment reminder ── */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/50 p-4 flex items-center gap-3">
          <i className="ri-information-line text-secondary-600 text-lg shrink-0"></i>
          <p className="text-sm text-foreground-700">
            <i className="ri-calendar-check-line mr-1 text-secondary-600"></i>
            Your <strong>monthly assignment</strong> is due on the 20th.
          </p>
        </div>

        {/* ── Monthly Journey Timeline (with month selector + per-month stages) ── */}
        <MonthlyJourneyTimeline activeMonth={activeMonth} onMonthChange={setActiveMonth} />

        {/* ── Action Cards Row (existing) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Monthly Assignment */}
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-file-text-line text-foreground-600 text-sm"></i>
              <span className="text-sm font-semibold text-foreground-900">Monthly assignment</span>
            </div>
            <p className="text-xs text-foreground-400 mb-1">Due 20/06/2026 · <span className="text-primary-600 font-semibold bg-primary-50 px-1.5 py-0.5 rounded">Open</span></p>
            <p className="text-sm text-foreground-600 mb-3">
              Portfolio report auto-pulls weekly reflections, evidence, quiz results, OTJH logs, KSB claims,{' '}
              <span className="text-primary-600">attendance</span> and tutor feedback.{' '}
              <span className="text-primary-600">Review, edit and submit.</span>
            </p>
            <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              Open assignment
            </button>
          </div>

          {/* Checkpoint Quiz */}
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-questionnaire-line text-foreground-600 text-sm"></i>
              <span className="text-sm font-semibold text-foreground-900">Checkpoint quiz</span>
            </div>
            <p className="text-xs mb-2"><span className="text-red-600 font-semibold bg-red-50 px-1.5 py-0.5 rounded">Not open yet</span></p>
            <p className="text-sm text-foreground-600 mb-3">
              Tests this month&apos;s main and secondary KSBs, EPA cross-reference and learning outcomes.{' '}
              Complete this before your coaching meeting.
            </p>
            <div className="flex items-center gap-2 mb-3">
              {['K2.1', 'K2.2', 'S3.1'].map(k => (
                <span key={k} className="text-xs font-semibold bg-foreground-100 text-foreground-600 px-2 py-0.5 rounded">{k}</span>
              ))}
            </div>
            <button disabled className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold opacity-50 cursor-not-allowed whitespace-nowrap">
              Start checkpoint
            </button>
          </div>

          {/* Coaching Meeting */}
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-calendar-check-line text-foreground-600 text-sm"></i>
              <span className="text-sm font-semibold text-foreground-900">Coaching meeting</span>
            </div>
            <p className="text-xs text-foreground-400 mb-1">
              21/06/2026–30/06/2026 ·{' '}
              <span className="text-background-600 font-semibold bg-background-200 px-1.5 py-0.5 rounded">Window closed</span>
            </p>
            <p className="text-sm text-foreground-600 mb-3">
              Coaching window opens on the 21st. Complete your assignment and checkpoint quiz first.
            </p>
            <button disabled className="px-4 py-2 border border-accent-400/30 text-accent-400 rounded-lg text-sm font-semibold opacity-60 cursor-not-allowed whitespace-nowrap">
              Book coaching meeting
            </button>
          </div>
        </div>

        {/* ── Assignment Progress (enhanced) ── */}
        <AssignmentProgress />

        {/* ── Checkpoint Quiz Unlock Rules (enhanced) ── */}
        <CheckpointQuizRules />

        {/* ── Coaching Readiness (enhanced) ── */}
        <CoachingReadinessPanel />

        {/* ── End of Month Outcome (dynamic per month) ── */}
        <EndOfMonthOutcome month={activeMonth} />
      </div>
    </WorkspaceShell>
  );
}