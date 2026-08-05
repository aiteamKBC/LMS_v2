import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

type TabKey = 'sessions' | 'learners' | 'evidence' | 'marking' | 'ksb';

interface TutorLearner {
  name: string;
  programme: string;
  cohort: string;
  progress: number;
  evidenceSubmitted: number;
  evidencePending: number;
  lastSubmission: string;
  attendance: number;
}

const TUTOR_LEARNERS: TutorLearner[] = [
  { name: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C — BA', progress: 42, evidenceSubmitted: 12, evidencePending: 3, lastSubmission: '8 Jun', attendance: 86 },
  { name: 'Sarah Mitchell', programme: 'Business Admin L3', cohort: 'Cohort A — BA', progress: 68, evidenceSubmitted: 22, evidencePending: 0, lastSubmission: '6 Jun', attendance: 94 },
  { name: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D — DT', progress: 28, evidenceSubmitted: 5, evidencePending: 4, lastSubmission: '7 Jun', attendance: 78 },
  { name: 'Emily Watson', programme: 'Digital Marketer L3', cohort: 'Cohort B — DM', progress: 85, evidenceSubmitted: 28, evidencePending: 0, lastSubmission: '5 Jun', attendance: 100 },
  { name: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C — BA', progress: 31, evidenceSubmitted: 4, evidencePending: 3, lastSubmission: '6 Jun', attendance: 83 },
  { name: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F — SWE', progress: 55, evidenceSubmitted: 16, evidencePending: 1, lastSubmission: '4 Jun', attendance: 94 },
  { name: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A — BA', progress: 60, evidenceSubmitted: 18, evidencePending: 1, lastSubmission: '4 Jun', attendance: 91 },
  { name: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E — EYE', progress: 12, evidenceSubmitted: 2, evidencePending: 2, lastSubmission: '1 Jun', attendance: 100 },
];

const TUTOR_SESSIONS = [
  { date: '11 Jun', day: 'Wed', time: '09:00–11:00', module: 'Business Communication', cohort: 'Cohort A — BA', learners: 14, status: 'upcoming' as const },
  { date: '12 Jun', day: 'Thu', time: '09:00–11:00', module: 'Programming Fundamentals', cohort: 'Cohort F — SWE', learners: 6, status: 'upcoming' as const },
  { date: '13 Jun', day: 'Fri', time: '09:00–11:00', module: 'Business Admin Practice', cohort: 'Cohort A — BA', learners: 14, status: 'upcoming' as const },
  { date: '16 Jun', day: 'Mon', time: '09:00–11:00', module: 'Business Communication', cohort: 'Cohort A — BA', learners: 14, status: 'scheduled' as const },
  { date: '18 Jun', day: 'Wed', time: '09:00–11:00', module: 'Business Communication', cohort: 'Cohort A — BA', learners: 14, status: 'scheduled' as const },
  { date: '20 Jun', day: 'Fri', time: '09:00–11:00', module: 'Business Admin Practice', cohort: 'Cohort A — BA', learners: 14, status: 'scheduled' as const },
];

const MARKING_QUEUE = [
  { id: 'mk-01', learner: 'Sophie Williams', assignment: 'Campaign Segmentation Worksheet', module: 'Marketing Planning', submitted: '8 Jun', type: 'Assignment', status: 'pending' as const, wordCount: 1200 },
  { id: 'mk-02', learner: 'James Okonkwo', assignment: 'Data Visualisation Report', module: 'Data Analysis', submitted: '7 Jun', type: 'Report', status: 'pending' as const, wordCount: 1800 },
  { id: 'mk-03', learner: 'Aisha Patel', assignment: 'Financial Statement Analysis', module: 'Financial Accounting', submitted: '6 Jun', type: 'Assignment', status: 'pending' as const, wordCount: 950 },
  { id: 'mk-04', learner: 'Sarah Mitchell', assignment: 'Board Meeting Minutes & Reflection', module: 'Business Admin', submitted: '5 Jun', type: 'Workplace Evidence', status: 'pending' as const, wordCount: 1500 },
  { id: 'mk-05', learner: 'Liam Foster', assignment: 'Risk Register & Mitigation Plan', module: 'Risk Management', submitted: '4 Jun', type: 'Project Evidence', status: 'pending' as const, wordCount: 2100 },
  { id: 'mk-06', learner: 'David Chen', assignment: 'Code Review & Documentation', module: 'Software Development', submitted: '3 Jun', type: 'Documentation', status: 'pending' as const, wordCount: 800 },
  { id: 'mk-07', learner: 'Emily Watson', assignment: 'Social Media Strategy Proposal', module: 'Digital Channels', submitted: '2 Jun', type: 'Report', status: 'marked' as const, wordCount: 1600 },
  { id: 'mk-08', learner: 'Maya Kapoor', assignment: 'HR Policy Review Reflection', module: 'HR Induction', submitted: '1 Jun', type: 'Reflection', status: 'pending' as const, wordCount: 600 },
];

const EVIDENCE_REVIEW = [
  { id: 'evr-01', learner: 'Sophie Williams', title: 'Workplace Reflection — Segmentation', type: 'Reflection', date: '8 Jun', ksbRefs: 'K5, K6, S8', status: 'pending' as const },
  { id: 'evr-02', learner: 'James Okonkwo', title: 'Data Cleaning Report', type: 'Report', date: '7 Jun', ksbRefs: 'K10, S12', status: 'pending' as const },
  { id: 'evr-03', learner: 'Aisha Patel', title: 'Month-end Reconciliation', type: 'Workplace Evidence', date: '6 Jun', ksbRefs: 'K8, S6', status: 'pending' as const },
  { id: 'evr-04', learner: 'Sarah Mitchell', title: 'Meeting Minutes — Board Prep', type: 'Workplace Evidence', date: '3 Jun', ksbRefs: 'K3, S4, B2', status: 'reviewed' as const },
  { id: 'evr-05', learner: 'Emily Watson', title: 'Social Media Campaign Results', type: 'Campaign Evidence', date: '5 Jun', ksbRefs: 'K7, S10, S11', status: 'pending' as const },
  { id: 'evr-06', learner: 'Liam Foster', title: 'Project Risk Register', type: 'Project Evidence', date: '4 Jun', ksbRefs: 'K14, S18', status: 'pending' as const },
];

const KSB_VALIDATION = [
  { id: 'ksbv-01', learner: 'Sophie Williams', ksb: 'K5 — Segmentation Principles', evidence: 2, status: 'Ready', risk: 'low' as const },
  { id: 'ksbv-02', learner: 'James Okonkwo', ksb: 'S12 — Data Analysis Tools', evidence: 1, status: 'Insufficient', risk: 'high' as const },
  { id: 'ksbv-03', learner: 'Aisha Patel', ksb: 'K8 — Financial Principles', evidence: 2, status: 'Ready', risk: 'low' as const },
  { id: 'ksbv-04', learner: 'Sarah Mitchell', ksb: 'S4 — Business Communication', evidence: 3, status: 'Ready', risk: 'low' as const },
  { id: 'ksbv-05', learner: 'Liam Foster', ksb: 'S18 — Risk Mitigation', evidence: 1, status: 'Insufficient', risk: 'medium' as const },
  { id: 'ksbv-06', learner: 'Emily Watson', ksb: 'B5 — Professional Development', evidence: 4, status: 'Exceeds', risk: 'low' as const },
];

export default function TutorDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('sessions');

  const pendingMarking = MARKING_QUEUE.filter(m => m.status === 'pending').length;
  const pendingEvidence = EVIDENCE_REVIEW.filter(e => e.status === 'pending').length;
  const pendingKSB = KSB_VALIDATION.filter(k => k.status === 'Ready').length;
  const atRiskLearners = TUTOR_LEARNERS.filter(l => l.attendance < 85).length;

  return (
    <WorkspaceShell
      role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel}
      pageTitle="Tutor Workspace" pageSubtitle="Session management, learner tracking, evidence review, assignment marking, and KSB validation"
      userName="Rachel Myers" userRole="Business Admin Tutor"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative h-full flex flex-col justify-center px-6 md:px-8">
            <h2 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Good morning, Rachel</h2>
            <p className="text-[13px] text-white/50">
              {TUTOR_SESSIONS.filter(s => s.status === 'upcoming').length} sessions this week &middot; {pendingMarking} to mark &middot; {pendingEvidence} evidence to review
            </p>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <TutorStatCard label="Sessions This Week" value={String(TUTOR_SESSIONS.filter(s => s.status === 'upcoming').length)} sub={`${TUTOR_SESSIONS.length} total`} icon="ri-presentation-line" color="primary" />
          <TutorStatCard label="Assignment Marking" value={String(pendingMarking)} sub={`${MARKING_QUEUE.length} in queue`} icon="ri-edit-line" color="accent" />
          <TutorStatCard label="Evidence Review" value={String(pendingEvidence)} sub="awaiting review" icon="ri-file-search-line" color="secondary" />
          <TutorStatCard label="KSB Validation" value={String(pendingKSB)} sub="ready for validation" icon="ri-checkbox-circle-line" color="primary" />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'sessions' as TabKey, label: 'Sessions', icon: 'ri-presentation-line', badge: TUTOR_SESSIONS.filter(s => s.status === 'upcoming').length },
            { key: 'learners' as TabKey, label: 'Learners', icon: 'ri-user-line', badge: TUTOR_LEARNERS.length },
            { key: 'evidence' as TabKey, label: 'Evidence Review', icon: 'ri-file-search-line', badge: pendingEvidence },
            { key: 'marking' as TabKey, label: 'Marking Queue', icon: 'ri-edit-line', badge: pendingMarking },
            { key: 'ksb' as TabKey, label: 'KSB Validation', icon: 'ri-checkbox-circle-line', badge: pendingKSB },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <AppIcon className={`${tab.icon} text-sm`}></AppIcon>
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className="bg-primary-100 text-primary-700 text-[10px] px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Sessions */}
        {activeTab === 'sessions' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Teaching Sessions</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Your upcoming and scheduled sessions — Cohort A (BA)</p>
              </div>
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> Create Session
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {TUTOR_SESSIONS.map((s, i) => (
                <div key={i} className={`bg-background-50 rounded-xl border p-4 card-premium ${s.status === 'upcoming' ? 'border-primary-200/50' : 'border-foreground-200/60'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{s.day}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span className="text-[10px] text-foreground-400">{s.date}</span>
                    </div>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                      s.status === 'upcoming' ? 'bg-primary-100 text-primary-700' : 'bg-foreground-100 text-foreground-500'
                    }`}>{s.status === 'upcoming' ? 'This Week' : 'Scheduled'}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground-900 mb-2">{s.module}</h4>
                  <div className="space-y-1 text-[11px] text-foreground-400 mb-3">
                    <p><AppIcon className="ri-time-line mr-1 text-[10px]"></AppIcon> {s.time}</p>
                    <p><AppIcon className="ri-group-line mr-1 text-[10px]"></AppIcon> {s.cohort} — {s.learners} learners</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex-1">
                      <AppIcon className="ri-video-line mr-1"></AppIcon> Join Teams
                    </button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-settings-3-line"></AppIcon>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Learners */}
        {activeTab === 'learners' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">My Learners</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">All learners in your assigned cohorts</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{TUTOR_LEARNERS.length} learners</span>
                <span className="text-[10px] text-foreground-400 bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{atRiskLearners} at risk</span>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {TUTOR_LEARNERS.map((l, i) => (
                  <div key={i} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${l.attendance < 85 ? 'bg-red-50/20' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                        l.attendance < 85 ? 'bg-red-100 text-red-700' : l.progress >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'
                      }`}>{l.name.charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[11px] text-foreground-400">{l.programme} · {l.cohort}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] shrink-0 flex-wrap">
                      <div className="flex items-center gap-1">
                        <div className="w-16 bg-background-200 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${l.progress >= 80 ? 'bg-emerald-500' : l.progress >= 50 ? 'bg-accent-500' : l.progress >= 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${l.progress}%` }}></div>
                        </div>
                        <span className="text-foreground-400 w-8">{l.progress}%</span>
                      </div>
                      <span className="text-foreground-400">Evidence: <strong className="text-foreground-700">{l.evidenceSubmitted}</strong></span>
                      <span className={`${l.attendance < 85 ? 'text-red-600 font-semibold' : 'text-foreground-400'}`}>Att: {l.attendance}%</span>
                      <span className="text-foreground-400">{l.lastSubmission}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Evidence Review */}
        {activeTab === 'evidence' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Evidence Review Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Review learner evidence against KSB criteria</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingEvidence} pending</span>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {EVIDENCE_REVIEW.map(item => (
                  <div key={item.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        item.status === 'reviewed' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        <AppIcon className="ri-file-search-line text-sm"></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground-900 truncate">{item.title}</p>
                        <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-foreground-400">{item.learner}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{item.type}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[11px] text-foreground-400">KSB: {item.ksbRefs}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-foreground-400">{item.date}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>{item.status === 'reviewed' ? 'Reviewed' : 'Pending'}</span>
                      {item.status === 'pending' && (
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          Review
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Marking Queue */}
        {activeTab === 'marking' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Assignment Marking Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Grade and provide feedback on learner assignments</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingMarking} to mark</span>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {MARKING_QUEUE.map(item => (
                  <div key={item.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${item.status === 'pending' ? 'hover:bg-background-100/50' : ''}`}>
                    <div className={`rounded-lg px-3 py-2 text-center shrink-0 min-w-[60px] ${
                      item.status === 'marked' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      <p className="text-[9px] font-medium uppercase">{item.type}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900">{item.assignment}</p>
                      <div className="flex items-center gap-x-2 gap-y-1 mt-1 flex-wrap">
                        <span className="text-[11px] text-foreground-400">{item.learner}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{item.module}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{item.wordCount} words</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-foreground-400">{item.submitted}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.status === 'marked' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>{item.status === 'marked' ? 'Marked' : 'Pending'}</span>
                      {item.status === 'pending' && (
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-edit-line mr-1"></AppIcon> Mark
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* KSB Validation */}
        {activeTab === 'ksb' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB Validation Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Validate KSB claims against learner evidence</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{pendingKSB} ready</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {KSB_VALIDATION.map(item => (
                <div key={item.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${item.risk === 'high' ? 'border-red-200/50 bg-red-50/20' : 'border-foreground-200/60'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                      item.status === 'Ready' ? 'bg-emerald-100 text-emerald-700' :
                      item.status === 'Exceeds' ? 'bg-accent-100 text-accent-700' :
                      'bg-red-100 text-red-700'
                    }`}>{item.status}</span>
                    {item.risk === 'high' && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">High Risk</span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-foreground-900 mb-1">{item.ksb}</h4>
                  <p className="text-[11px] text-foreground-400 mb-3">{item.learner} · {item.evidence} evidence item{item.evidence > 1 ? 's' : ''}</p>
                  <button className={`w-full px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                    item.status === 'Ready' ? 'bg-primary-500 text-white hover:bg-primary-600' :
                    item.status === 'Exceeds' ? 'bg-emerald-600 text-white hover:bg-emerald-700' :
                    'bg-background-50 border border-background-200 text-foreground-600 hover:bg-background-100'
                  }`}>
                    {item.status === 'Ready' ? 'Validate KSB' :
                     item.status === 'Exceeds' ? 'View Exceeded KSB' :
                     'Request More Evidence'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Quick Actions */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Start Session', icon: 'ri-presentation-line' },
            { label: 'Mark Assignments', icon: 'ri-edit-line' },
            { label: 'Review Evidence', icon: 'ri-file-search-line' },
            { label: 'Validate KSBs', icon: 'ri-checkbox-circle-line' },
            { label: 'Feedback Queue', icon: 'ri-chat-3-line' },
            { label: 'AI Marking', icon: 'ri-robot-line' },
            { label: 'Resources', icon: 'ri-folder-line' },
            { label: 'Quiz Results', icon: 'ri-bar-chart-line' },
            { label: 'OTJH Validation', icon: 'ri-time-line' },
            { label: 'Learner Reports', icon: 'ri-bar-chart-box-line' },
            { label: 'Record Session', icon: 'ri-video-line' },
            { label: 'Upload Resources', icon: 'ri-upload-cloud-line' },
          ].map(link => (
            <button
              key={link.label}
              className="flex items-center gap-2 px-3 py-2.5 bg-background-50 rounded-xl border border-foreground-200/60 text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className={`${link.icon} text-sm`}></AppIcon>
              {link.label}
            </button>
          ))}
        </section>
      </div>
    </WorkspaceShell>
  );
}

function TutorStatCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
      </div>
      <p className="text-[11px] text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}