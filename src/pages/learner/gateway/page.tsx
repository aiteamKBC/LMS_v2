import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { GatewayHeroSection } from './components/GatewayHeroSection';
import { EPATimeline } from './components/EPATimeline';
import { EmployerReadiness } from './components/EmployerReadiness';
import { ActionCentre } from './components/ActionCentre';
import { CoachRecommendations } from './components/CoachRecommendations';
import { PredictedEPAOutcome } from './components/PredictedEPAOutcome';
import { KSBRiskAnalysis } from './components/KSBRiskAnalysis';
import { PortfolioHealthCheck } from './components/PortfolioHealthCheck';
import { EvidenceCoverage } from './components/EvidenceCoverage';
import { EPAComponentReadiness } from './components/EPAComponentReadiness';
import { BookMockSessionModal } from './components/BookMockSessionModal';
import { GATEWAY_PROGRESS_STATUS, MOCK_REVIEW_ENHANCEMENTS, EPA_JOURNEY_STAGES, CURRENT_POSITION } from '@/mocks/gateway-readiness';

const learnerNav = roleNavMap.learner;

type TabKey = 'overview' | 'ksb-summary' | 'portfolio' | 'mock-review';

interface KSBCategory {
  category: string;
  codePrefix: string;
  total: number;
  validated: number;
  evidenced: number;
  notStarted: number;
}

const KSB_CATEGORIES: KSBCategory[] = [
  { category: 'Knowledge', codePrefix: 'K', total: 24, validated: 8, evidenced: 4, notStarted: 12 },
  { category: 'Skills', codePrefix: 'S', total: 30, validated: 7, evidenced: 5, notStarted: 18 },
  { category: 'Behaviours', codePrefix: 'B', total: 18, validated: 3, evidenced: 4, notStarted: 11 },
];

const PORTFOLIO_CHECKLIST = [
  { id: 'pc-01', item: 'Completed all mandatory training modules', status: 'done' as const, detail: '7 of 7 completed' },
  { id: 'pc-02', item: 'OTJH minimum hours logged and validated', status: 'in-progress' as const, detail: '74 of 120 hours — on track for Gateway target' },
  { id: 'pc-03', item: 'All KSBs mapped to at least one piece of evidence', status: 'in-progress' as const, detail: '18 of 72 KSBs validated — 38% complete' },
  { id: 'pc-04', item: 'Minimum 2 pieces of evidence per KSB category', status: 'not-started' as const, detail: 'Knowledge: 8, Skills: 7, Behaviours: 3 — needs more' },
  { id: 'pc-05', item: 'Progress Reviews signed by learner, coach, and employer', status: 'in-progress' as const, detail: '2 of 8 reviews completed and signed' },
  { id: 'pc-06', item: 'Monthly coaching log complete with reflections', status: 'in-progress' as const, detail: '1 of 18 coaching sessions documented' },
  { id: 'pc-07', item: 'Workplace project evidence compiled and cross-referenced', status: 'not-started' as const, detail: 'No workplace project evidence submitted yet' },
  { id: 'pc-08', item: 'Line manager workplace confirmation statement prepared', status: 'not-started' as const, detail: 'Employer confirmation required before Gateway' },
  { id: 'pc-09', item: 'Maths and English Level 2 certificates on file', status: 'done' as const, detail: 'GCSE Maths B, English Language A — verified' },
  { id: 'pc-10', item: 'Professional discussion preparation complete', status: 'not-started' as const, detail: 'Scheduled for Month 16' },
  { id: 'pc-11', item: 'Portfolio of evidence organised and indexed', status: 'not-started' as const, detail: '12 items submitted — needs cross-referencing to KSBs' },
  { id: 'pc-12', item: 'Gateway declaration form drafted', status: 'not-started' as const, detail: 'No draft started yet' },
];

const GATEWAY_MILESTONES = [
  { id: 'gm-01', milestone: 'Onboarding & Induction Complete', date: '19 May 2026', status: 'completed' as const },
  { id: 'gm-02', milestone: 'Month 1 Foundation Complete', date: '16 Jun 2026', status: 'in-progress' as const },
  { id: 'gm-03', milestone: 'Month 3 First Progress Check', date: 'Aug 2026', status: 'upcoming' as const },
  { id: 'gm-04', milestone: 'Month 6 Mid-point Review', date: 'Nov 2026', status: 'upcoming' as const },
  { id: 'gm-05', milestone: 'Month 9 KSB Portfolio Review', date: 'Feb 2027', status: 'upcoming' as const },
  { id: 'gm-06', milestone: 'Month 12 Gateway Readiness Check', date: 'May 2027', status: 'upcoming' as const },
  { id: 'gm-07', milestone: 'Month 15 Gateway Submission', date: 'Aug 2027', status: 'upcoming' as const },
  { id: 'gm-08', milestone: 'Gateway Panel Decision', date: 'Sep 2027', status: 'upcoming' as const },
  { id: 'gm-09', milestone: 'EPA Preparation', date: 'Oct 2027', status: 'upcoming' as const },
  { id: 'gm-10', milestone: 'EPA Assessment', date: 'Nov 2027', status: 'upcoming' as const },
];

export default function GatewayReadinessPage() {
  const p = LEARNER_PROFILE;
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [showBookMockModal, setShowBookMockModal] = useState(false);

  // Book Mock Session is only active when learner is between Gateway and EPA stages
  const gatewayStage = EPA_JOURNEY_STAGES.find(s => s.id === 's4');
  const epaStage = EPA_JOURNEY_STAGES.find(s => s.id === 's5');
  const isGatewayPassed = gatewayStage?.completed ?? false;
  const isEPANotStarted = epaStage && !epaStage.completed && !epaStage.current;
  const canBookMockSession = CURRENT_POSITION.stage === 'Gateway';

  const portfolioDone = PORTFOLIO_CHECKLIST.filter(i => i.status === 'done').length;
  const portfolioTotal = PORTFOLIO_CHECKLIST.length;
  const validatedTotal = KSB_CATEGORIES.reduce((sum, c) => sum + c.validated, 0);
  const ksbTotal = KSB_CATEGORIES.reduce((sum, c) => sum + c.total, 0);
  const gatewayReadiness = Math.round((validatedTotal / ksbTotal) * 100);

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Gateway Readiness" pageSubtitle="Prepare for your Gateway and End-Point Assessment"
      userName={p.fullName} userRole={`${p.programme} ${p.programmeLevel} Apprentice`}
    >
      <div className="p-6 space-y-6">
        {/* 1. Hero Banner + What's Blocking Me + Countdown */}
        <GatewayHeroSection />

        {/* 2. EPA Readiness Cards (enhanced) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ReadinessCard label="KSB Completion" value={`${gatewayReadiness}%`} sub={`${validatedTotal}/${ksbTotal} validated`} icon="ri-bar-chart-2-line" color="primary" status="amber" />
          <ReadinessCard label="Portfolio Progress" value={`${portfolioDone}/${portfolioTotal}`} sub="items complete" icon="ri-folder-check-line" color="accent" status="amber" />
          <ReadinessCard label="OTJH Target" value={`${p.otjhCompleted}/${p.otjhTarget}`} sub="hours logged" icon="ri-time-line" color="secondary" status="amber" />
          <ReadinessCard label="Gateway Date" value={p.gatewayTargetDate} sub={p.epaTargetDate + ' EPA'} icon="ri-calendar-check-line" color="primary" status="info" />
        </div>

        {/* 3. Predicted EPA Outcome + Predicted Gateway Date Card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <PredictedEPAOutcome />
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 card-premium">
            <div className="flex items-start justify-between mb-3">
              <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center">
                <i className="ri-calendar-todo-line text-primary-600"></i>
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">
                {GATEWAY_PROGRESS_STATUS.label}
              </span>
            </div>
            <p className="text-xs text-foreground-400 mb-1">Expected Gateway</p>
            <p className="text-2xl font-heading font-bold text-foreground-900">{p.gatewayTargetDate}</p>
            <p className="text-xs text-foreground-500 mt-1">{GATEWAY_PROGRESS_STATUS.explanation}</p>
            <div className="mt-2 flex items-center gap-1 text-[9px] text-foreground-400">
              <i className="ri-time-line"></i>
              <span>Progress Status: {GATEWAY_PROGRESS_STATUS.detail}</span>
            </div>
          </div>
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 card-premium">
            <div className="flex items-start justify-between mb-3">
              <span className="w-9 h-9 rounded-lg bg-accent-100 flex items-center justify-center">
                <i className="ri-hourglass-line text-accent-700"></i>
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">
                Countdown
              </span>
            </div>
            <p className="text-xs text-foreground-400 mb-1">Estimated Time To Gateway</p>
            <p className="text-2xl font-heading font-bold text-accent-700">16 Months</p>
            <p className="text-xs text-foreground-500 mt-1">482 Days Remaining</p>
            <div className="mt-2 flex items-center gap-1 text-[9px] text-foreground-400">
              <i className="ri-calendar-line"></i>
              <span>Target: {p.gatewayTargetDate}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'overview' as TabKey, label: 'EPA Readiness', icon: 'ri-dashboard-line' },
            { key: 'ksb-summary' as TabKey, label: 'KSB Completion', icon: 'ri-bar-chart-2-line' },
            { key: 'portfolio' as TabKey, label: 'Portfolio Checklist', icon: 'ri-checkbox-multiple-line' },
            { key: 'mock-review' as TabKey, label: 'Mock Review', icon: 'ri-chat-check-line' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
            </button>
          ))}
        </div>

        {/* EPA Readiness Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* EPA Readiness Timeline */}
            <EPATimeline />

            {/* Gateway Milestones Timeline (existing) */}
            <section>
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Gateway Journey Timeline</h3>
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                <div className="space-y-0">
                  {GATEWAY_MILESTONES.map((milestone, i) => (
                    <div key={milestone.id} className="flex items-start gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          milestone.status === 'completed' ? 'bg-emerald-500 text-white' :
                          milestone.status === 'in-progress' ? 'bg-primary-500 text-white ring-4 ring-primary-100' :
                          'bg-background-200 text-foreground-400'
                        }`}>
                          {milestone.status === 'completed' ? <i className="ri-check-line text-sm"></i> : i + 1}
                        </div>
                        {i < GATEWAY_MILESTONES.length - 1 && (
                          <div className={`w-0.5 h-10 ${milestone.status === 'completed' ? 'bg-emerald-300' : 'bg-background-200'}`}></div>
                        )}
                      </div>
                      <div className={`pb-5 ${milestone.status === 'in-progress' ? 'pt-1' : 'pt-1.5'}`}>
                        <p className={`text-sm font-semibold ${milestone.status === 'upcoming' ? 'text-foreground-400' : 'text-foreground-900'}`}>
                          {milestone.milestone}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-foreground-400">{milestone.date}</span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            milestone.status === 'in-progress' ? 'bg-primary-100 text-primary-700' :
                            'bg-background-100 text-foreground-400'
                          }`}>
                            {milestone.status === 'completed' ? 'Complete' : milestone.status === 'in-progress' ? 'In Progress' : 'Upcoming'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* EPA Component Readiness */}
            <EPAComponentReadiness />

            {/* Employer Readiness */}
            <EmployerReadiness />

            {/* Action Centre */}
            <ActionCentre />

            {/* Coach Recommendations */}
            <CoachRecommendations />

            {/* What is the Gateway (existing) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">What is the Gateway?</h3>
                <p className="text-sm text-foreground-600 leading-relaxed mb-4">
                  The Gateway is the formal checkpoint between your on-programme learning and the End-Point Assessment (EPA). 
                  Before you can enter Gateway, your employer, coach, and KBC must all agree that you have:
                </p>
                <ul className="space-y-2">
                  {[
                    'Completed all mandatory training and achieved the required KSBs',
                    'Logged the minimum required off-the-job training hours (120 hours)',
                    'Passed all required qualifications including Maths and English Level 2',
                    'Built a portfolio of evidence demonstrating competence across all KSBs',
                    'Completed all progress reviews with signatures from all parties',
                    'Met the minimum programme duration (12 months)',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground-600">
                      <i className="ri-checkbox-circle-line text-primary-500 mt-0.5 shrink-0"></i>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              {/* Your EPA Components (existing) */}
              <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Your EPA Components</h3>
                <p className="text-sm text-foreground-600 leading-relaxed mb-4">
                  Marketing Executive Level 4 (ST0803) EPA consists of:
                </p>
                <div className="space-y-3">
                  {[
                    { title: 'Professional Discussion underpinned by Portfolio', weight: '50%', desc: 'A 60-minute structured discussion with an independent assessor, using your portfolio as evidence. You will discuss how you have applied your KSBs in the workplace.' },
                    { title: 'Project showcase (including presentation)', weight: '50%', desc: 'A 15-minute presentation followed by 30 minutes of Q&A with the assessor. You will present a marketing project you led at Tim Hortons, demonstrating strategic thinking and measurable impact.' },
                  ].map(comp => (
                    <div key={comp.title} className="bg-background-100/50 rounded-lg p-3.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-foreground-900">{comp.title}</p>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">Weight: {comp.weight}</span>
                      </div>
                      <p className="text-xs text-foreground-500 leading-relaxed">{comp.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 bg-background-50 rounded-lg p-3 border border-foreground-200/50">
                  <p className="text-xs text-amber-800">
                    <strong>Important:</strong> EPA grades are Fail, Pass, or Distinction. Start preparing early — 
                    learners who begin portfolio organisation by Month 4 achieve Distinction at 3x the rate of those who start later.
                  </p>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* KSB Completion Summary */}
        {activeTab === 'ksb-summary' && (
          <section className="space-y-6">
            {/* At Risk KSBs */}
            <KSBRiskAnalysis />

            {/* Existing KSB category cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {KSB_CATEGORIES.map(cat => {
                const pct = Math.round((cat.validated / cat.total) * 100);
                return (
                  <div key={cat.category} className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-heading font-semibold text-foreground-900">{cat.category}</h4>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{cat.total} total</span>
                    </div>
                    {/* Donut-like visual */}
                    <div className="flex items-center justify-center mb-3">
                      <div className="relative w-24 h-24">
                        <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="oklch(var(--background-200))" strokeWidth="4"></circle>
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke={pct >= 50 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444'} strokeWidth="4" strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round"></circle>
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-lg font-bold text-foreground-900">{pct}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-foreground-500">Validated</span>
                        <span className="font-semibold text-emerald-600">{cat.validated}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-foreground-500">Evidenced (pending)</span>
                        <span className="font-semibold text-amber-600">{cat.evidenced}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-foreground-500">Not Started</span>
                        <span className="font-semibold text-red-600">{cat.notStarted}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Evidence Coverage */}
            <EvidenceCoverage />

            <div className="bg-background-50 rounded-xl border border-foreground-200/50 p-5">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                  <i className="ri-lightbulb-line text-primary-600"></i>
                </span>
                <div>
                  <p className="text-sm font-semibold text-primary-900 mb-1">Gateway Target: 100% KSB Validation</p>
                  <p className="text-sm text-primary-700 leading-relaxed">
                    You need all 72 KSBs validated before Gateway. At your current pace of ~2 KSBs per week validated through evidence, 
                    you are on track to complete by {p.gatewayTargetDate}. Focus on linking every piece of evidence to at least 2-3 KSBs 
                    to accelerate your progress.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Portfolio Checklist */}
        {activeTab === 'portfolio' && (
          <section className="space-y-6">
            {/* Portfolio Health Check */}
            <PortfolioHealthCheck />

            {/* Existing checklist */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Portfolio Checklist</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Complete all items before Gateway submission — {portfolioDone}/{portfolioTotal} done</p>
                </div>
                <div className="bg-background-200 rounded-full h-2 w-40 overflow-hidden">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.round((portfolioDone / portfolioTotal) * 100)}%` }}></div>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
                <div className="divide-y divide-background-200/30">
                  {PORTFOLIO_CHECKLIST.map(item => (
                    <div key={item.id} className="p-4 flex items-start gap-4">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        item.status === 'done' ? 'bg-emerald-100 text-emerald-600' :
                        item.status === 'in-progress' ? 'bg-amber-100 text-amber-600' :
                        'bg-background-100 text-foreground-300'
                      }`}>
                        <i className={`${item.status === 'done' ? 'ri-check-line' : item.status === 'in-progress' ? 'ri-time-line' : 'ri-subtract-line'} text-sm`}></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${item.status === 'done' ? 'text-foreground-500 line-through' : 'text-foreground-900'}`}>{item.item}</p>
                        <p className="text-xs text-foreground-400 mt-0.5">{item.detail}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${
                        item.status === 'done' ? 'bg-emerald-100 text-emerald-700' :
                        item.status === 'in-progress' ? 'bg-amber-100 text-amber-700' :
                        'bg-background-100 text-foreground-400'
                      }`}>
                        {item.status === 'done' ? 'Complete' : item.status === 'in-progress' ? 'In Progress' : 'Not Started'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Mock Review */}
        {activeTab === 'mock-review' && (
          <section className="space-y-6">
            <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Mock Professional Discussion Questions</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Practice answering these EPA-style questions. Your coach can run a mock session with you.</p>
                </div>
                {canBookMockSession ? (
                  <button
                    onClick={() => setShowBookMockModal(true)}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-calendar-check-line mr-1"></i> Book Mock Session
                  </button>
                ) : (
                  <div className="relative group">
                    <button
                      disabled
                      className="px-4 py-2 bg-background-200 text-foreground-400 rounded-lg text-xs font-semibold cursor-not-allowed whitespace-nowrap"
                    >
                      <i className="ri-calendar-check-line mr-1"></i> Book Mock Session
                    </button>
                    <div className="absolute right-0 top-full mt-2 w-60 bg-foreground-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-20 text-center">
                      Mock sessions are only available after your Gateway has been approved. You are currently at the <strong>Gateway Preparation</strong> stage.
                      <div className="absolute bottom-full right-4 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[5px] border-b-foreground-900"></div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {MOCK_REVIEW_ENHANCEMENTS.map(q => (
                  <div key={q.id} className="border border-background-200/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedQuestion(expandedQuestion === q.id ? null : q.id)}
                      className="w-full flex items-start gap-3 p-4 text-left hover:bg-background-100/50 transition-smooth cursor-pointer"
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        q.difficulty === 'Hard' ? 'bg-red-100 text-red-600' :
                        q.difficulty === 'Medium' ? 'bg-amber-100 text-amber-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}>
                        <i className="ri-question-line text-sm"></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground-900">{q.question}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs text-foreground-400">KSBs: {q.ksbs}</span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            q.difficulty === 'Hard' ? 'bg-red-100 text-red-700' :
                            q.difficulty === 'Medium' ? 'bg-amber-100 text-amber-700' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>{q.difficulty}</span>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">
                            EPA Relevance: {q.epaRelevance}%
                          </span>
                        </div>
                      </div>
                      <i className={`${expandedQuestion === q.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300 shrink-0`}></i>
                    </button>
                    {expandedQuestion === q.id && (
                      <div className="px-4 pb-4 border-t border-background-200/30 pt-3 bg-background-100/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {/* Example Response */}
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-foreground-700 mb-1.5">
                            <i className="ri-chat-smile-2-line text-accent-500 mr-1"></i>
                            Example Response
                          </p>
                          <div className="bg-background-50 rounded-lg p-3 border border-background-200/50">
                            <p className="text-xs text-foreground-600 leading-relaxed italic">{q.exampleResponse}</p>
                          </div>
                        </div>

                        {/* How to prepare */}
                        <p className="text-xs font-semibold text-foreground-700 mb-2">How to prepare:</p>
                        <ul className="space-y-1.5">
                          <li className="text-xs text-foreground-500 flex items-start gap-1.5">
                            <i className="ri-checkbox-blank-circle-fill text-[6px] text-primary-400 mt-1.5 shrink-0"></i>
                            Use the STAR method (Situation, Task, Action, Result) to structure your answer
                          </li>
                          <li className="text-xs text-foreground-500 flex items-start gap-1.5">
                            <i className="ri-checkbox-blank-circle-fill text-[6px] text-primary-400 mt-1.5 shrink-0"></i>
                            Link your answer to specific workplace examples from Tim Hortons
                          </li>
                          <li className="text-xs text-foreground-500 flex items-start gap-1.5">
                            <i className="ri-checkbox-blank-circle-fill text-[6px] text-primary-400 mt-1.5 shrink-0"></i>
                            Reference the KSBs listed and explain how you demonstrated them
                          </li>
                          <li className="text-xs text-foreground-500 flex items-start gap-1.5">
                            <i className="ri-checkbox-blank-circle-fill text-[6px] text-primary-400 mt-1.5 shrink-0"></i>
                            Practice aloud — record yourself or practise with your coach
                          </li>
                        </ul>

                        {/* Coach Tip */}
                        <div className="mt-3 p-3 bg-accent-50 rounded-lg border border-accent-200/50">
                          <p className="text-xs text-accent-700 font-medium">
                            <i className="ri-user-voice-line mr-1"></i>
                            Coach tip: {q.coachTip}
                          </p>
                        </div>

                        {/* Preparation Resources */}
                        {q.prepResources.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-semibold text-foreground-700 mb-1.5">Preparation Resources:</p>
                            <div className="flex flex-wrap gap-2">
                              {q.prepResources.map((res, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200/50">
                                  <i className={`${res.type === 'Reading' ? 'ri-book-open-line' : 'ri-file-copy-line'} text-[10px]`}></i>
                                  {res.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Mock Review Scoring Guide (existing) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { grade: 'Distinction', desc: 'Consistently exceeds expectations. Demonstrates strategic thinking, innovation, and measurable business impact across all KSBs.', color: 'accent' },
                { grade: 'Pass', desc: 'Meets all requirements. Demonstrates competent application of KSBs in the workplace with clear evidence throughout the portfolio.', color: 'primary' },
                { grade: 'Fail', desc: 'Does not meet minimum requirements. Evidence is insufficient, KSBs are not demonstrated, or the portfolio is incomplete. Requires re-take.', color: 'secondary' },
              ].map(g => (
                <div key={g.grade} className={`bg-background-50 rounded-xl border border-background-200/50 p-4 card-premium text-center`}>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-${g.color}-100 text-${g.color}-700 mb-2 inline-block`}>{g.grade}</span>
                  <p className="text-xs text-foreground-500 leading-relaxed mt-2">{g.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

      {/* Book Mock Session Modal */}
      <BookMockSessionModal
        isOpen={showBookMockModal}
        onClose={() => setShowBookMockModal(false)}
        coachName={p.coach.name}
        coachEmail={p.coach.email}
      />
    </WorkspaceShell>
  );
}

function ReadinessCard({ label, value, sub, icon, color, status }: {
  label: string; value: string; sub: string; icon: string; color: string; status: 'amber' | 'green' | 'info';
}) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 card-premium">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
          status === 'amber' ? 'bg-amber-100 text-amber-700' :
          status === 'green' ? 'bg-emerald-100 text-emerald-700' :
          'bg-primary-100 text-primary-700'
        }`}>
          {status === 'amber' ? 'In Progress' : status === 'green' ? 'Ready' : 'Info'}
        </span>
      </div>
      <p className="text-xs text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-xs text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}