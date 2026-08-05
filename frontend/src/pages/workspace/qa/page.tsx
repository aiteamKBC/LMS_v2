import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

type TabKey = 'evidence' | 'otjh' | 'ksb' | 'rejected' | 'sampling';

interface QAEvidenceItem {
  id: string;
  learner: string;
  title: string;
  type: string;
  module: string;
  submitted: string;
  coachStatus: string;
  qaStatus: string;
  risk: string;
}

// Evidence QA Items — connected to demo-evidence.ts DEMO_EVIDENCE
const EVIDENCE_QA_ITEMS: QAEvidenceItem[] = [
  { id: 'ev-003', learner: 'Sophie Williams', title: 'STP Model Application — Breakfast Campaign', type: 'Assignment', module: 'Consumer Insight', submitted: '10 Jun', coachStatus: 'Pending', qaStatus: 'Pending', risk: 'low' },
  { id: 'ev-007', learner: 'James Okafor', title: 'Campaign Planning — Autumn Product Launch', type: 'Assignment', module: 'Marketing Planning', submitted: '08 Jun', coachStatus: 'Pending', qaStatus: 'Pending', risk: 'low' },
  { id: 'ev-008', learner: 'Mia Robinson', title: 'Project Initiation Document — Store Renovation', type: 'Workplace Document', module: 'Project Initiation', submitted: '03 Jun', coachStatus: 'Pending', qaStatus: 'Escalated', risk: 'high' },
  { id: 'ev-013', learner: 'Emily Chen', title: 'Document Management Process Map', type: 'Workplace Task', module: 'Admin Fundamentals', submitted: '09 Jun', coachStatus: 'Pending', qaStatus: 'Pending', risk: 'low' },
  { id: 'ev-001', learner: 'Sophie Williams', title: 'Customer Segmentation Analysis — Tim Hortons', type: 'Workplace Task', module: 'Consumer Insight', submitted: '05 Jun', coachStatus: 'Validated', qaStatus: 'Sampled', risk: 'low' },
  { id: 'ev-010', learner: 'Ava Thompson', title: 'Operations Strategy Report — M&S Food Hall', type: 'Major Project', module: 'Operations Strategy', submitted: '02 May', coachStatus: 'Validated', qaStatus: 'Sampled', risk: 'low' },
  { id: 'ev-011', learner: 'Ava Thompson', title: 'Leadership in Practice — 360 Feedback Portfolio', type: 'Portfolio', module: 'Leadership', submitted: '20 May', coachStatus: 'Validated', qaStatus: 'Sampled', risk: 'low' },
  { id: 'ev-009', learner: 'Mia Robinson', title: 'Stakeholder Register', type: 'Workplace Document', module: 'PM Fundamentals', submitted: '15 Apr', coachStatus: 'Validated', qaStatus: 'Pending', risk: 'high' },
];

const OTJH_QA_ITEMS = [
  { id: 'otqa-01', learner: 'Sophie Williams', hours: 2.5, activity: 'Live Session: Customer Segmentation', date: '4 Jun', status: 'Pending', risk: 'low' },
  { id: 'otqa-02', learner: 'James Okonkwo', hours: 1.5, activity: 'Self-Study: Data Analysis', date: '3 Jun', status: 'Pending', risk: 'high' },
  { id: 'otqa-03', learner: 'Aisha Patel', hours: 3.0, activity: 'Workplace: Financial Records', date: '2 Jun', status: 'Pending', risk: 'medium' },
  { id: 'otqa-04', learner: 'Liam Foster', hours: 2.0, activity: 'Project Risk Assessment', date: '1 Jun', status: 'Sampled', risk: 'low' },
  { id: 'otqa-05', learner: 'Sarah Mitchell', hours: 1.0, activity: 'Coaching Meeting', date: '31 May', status: 'Pending', risk: 'low' },
  { id: 'otqa-06', learner: 'Emily Watson', hours: 2.5, activity: 'Campaign Analytics Review', date: '30 May', status: 'Validated', risk: 'low' },
];

const KSB_QA_ITEMS = [
  { id: 'ksbqa-01', learner: 'James Okonkwo', ksbRef: 'S12 — Data Analysis', evidenceCount: 1, status: 'Under Review', risk: 'high' },
  { id: 'ksbqa-02', learner: 'Aisha Patel', ksbRef: 'K8 — Financial Principles', evidenceCount: 2, status: 'Pending', risk: 'medium' },
  { id: 'ksbqa-03', learner: 'Sophie Williams', ksbRef: 'B3 — Professional Ethics', evidenceCount: 3, status: 'Sampled', risk: 'low' },
  { id: 'ksbqa-04', learner: 'Liam Foster', ksbRef: 'S18 — Risk Mitigation', evidenceCount: 1, status: 'Pending', risk: 'medium' },
  { id: 'ksbqa-05', learner: 'David Chen', ksbRef: 'K15 — Software Architecture', evidenceCount: 2, status: 'Pending', risk: 'low' },
];

// Rejected items — includes connected Liam Patel pre-active QA rejection (qa-pre-002)
const REJECTED_ITEMS = [
  {
    id: 'qa-pre-002', learner: 'Liam Patel', item: 'Pre-Active QA Final Review — Data Analyst L4', type: 'Pre-Active QA',
    reason: 'CRITICAL: (1) Settled status share code not verified — residency test fails. (2) DAS not confirmed — employer not on DAS service. (3) ILR record not created — no confirmed start date. (4) Training plan employer signature missing.',
    rejectedBy: 'Patricia Nkosi (QA)', date: '7 Apr 2026', status: 'Resubmit Required'
  },
  {
    id: 'qa-ev-mia', learner: 'Mia Robinson', item: 'Project Kickoff Notes — June 2026', type: 'Evidence',
    reason: 'Evidence does not sufficiently demonstrate KSB K2 (stakeholder management). Only one activity logged. Employer validation missing. Coach must follow up urgently.',
    rejectedBy: 'Patricia Nkosi (QA)', date: '7 Jun 2026', status: 'Resubmit Required'
  },
  {
    id: 'otjh-rej', learner: 'Mia Robinson', item: 'OTJH Claim — Stakeholder Interview (5 Jun)', type: 'OTJH',
    reason: 'Insufficient evidence provided — please resubmit with employer confirmation email or calendar invite.',
    rejectedBy: 'Helen Curtis (Tutor)', date: '7 Jun 2026', status: 'Resubmit Required'
  },
  {
    id: 'rj-04', learner: 'Connor Walsh', item: 'Week 2 Assignment — Marketing Environment', type: 'Evidence',
    reason: 'Missing employer workplace context. Assignment is purely theoretical — must reference a real example from Sainsbury\'s.',
    rejectedBy: 'Patricia Nkosi (QA)', date: '4 Jun 2026', status: 'Resubmitted'
  },
];

const SAMPLING_QUEUE = [
  { id: 'sp-01', type: 'Evidence', scope: 'All learners — Cohort B (DM)', total: 120, sampled: 18, percentage: 15, status: 'In Progress', officer: 'Emma Clarke' },
  { id: 'sp-02', type: 'OTJH', scope: 'All learners — Cohort A (BA)', total: 340, sampled: 34, percentage: 10, status: 'Scheduled', officer: '—' },
  { id: 'sp-03', type: 'KSB', scope: 'High-risk learners only', total: 45, sampled: 12, percentage: 27, status: 'Completed', officer: 'QA Lead' },
  { id: 'sp-04', type: 'Progress Reviews', scope: 'Cohort C (BA) — June 2026', total: 8, sampled: 3, percentage: 38, status: 'In Progress', officer: 'Emma Clarke' },
];

export default function QADashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('evidence');

  const pendingEvidence = EVIDENCE_QA_ITEMS.filter(e => e.qaStatus === 'Pending').length;
  const pendingOTJH = OTJH_QA_ITEMS.filter(o => o.status === 'Pending').length;
  const pendingKSB = KSB_QA_ITEMS.filter(k => k.status === 'Pending').length;
  const rejectedCount = REJECTED_ITEMS.filter(r => r.status === 'Resubmit Required').length;

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="QA Review Centre" pageSubtitle="Evidence QA, OTJH QA, KSB QA, rejected items management, and sampling oversight"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="QA Review Centre"
          description={`${pendingEvidence} evidence items awaiting QA. ${pendingOTJH} OTJH entries pending review. ${rejectedCount} rejected needing resubmission. ${SAMPLING_QUEUE.filter(s => s.status === 'In Progress').length} active samples in progress.`}
          icon="ri-shield-check-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20quality%20assurance%20evidence%20inspection%20checklist%20professional%20purple%20gold%20accent%20editorial%20photography%20modern%20clean%20minimalist%20office%20workspace&width=400&height=160&seq=qa-hero-01&orientation=landscape"
          imageAlt="QA Review Centre"
          stats={[
            { label: 'Pending QA', value: String(pendingEvidence + pendingOTJH + pendingKSB) },
            { label: 'Rejected', value: String(rejectedCount), variant: 'danger' },
            { label: 'Samples', value: '4' },
          ]}
        />

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <QAStatCard label="Evidence QA" value={String(pendingEvidence)} sub="awaiting review" icon="ri-folder-upload-line" color="primary" />
          <QAStatCard label="OTJH QA" value={String(pendingOTJH)} sub="pending review" icon="ri-time-line" color="accent" />
          <QAStatCard label="KSB QA" value={String(pendingKSB)} sub="pending review" icon="ri-bar-chart-2-line" color="secondary" />
          <QAStatCard label="Rejected Items" value={String(rejectedCount)} sub="need resubmission" icon="ri-close-circle-line" color="primary" />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'evidence' as TabKey, label: 'Evidence QA', icon: 'ri-folder-upload-line', badge: pendingEvidence },
            { key: 'otjh' as TabKey, label: 'OTJH QA', icon: 'ri-time-line', badge: pendingOTJH },
            { key: 'ksb' as TabKey, label: 'KSB QA', icon: 'ri-bar-chart-2-line', badge: pendingKSB },
            { key: 'rejected' as TabKey, label: 'Rejected Items', icon: 'ri-close-circle-line', badge: rejectedCount },
            { key: 'sampling' as TabKey, label: 'Sampling Queue', icon: 'ri-pie-chart-2-line' },
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
                <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Evidence QA */}
        {activeTab === 'evidence' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Evidence QA Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Evidence items submitted by learners — review for quality and KSB alignment</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{EVIDENCE_QA_ITEMS.length} total</span>
                <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingEvidence} pending</span>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {EVIDENCE_QA_ITEMS.map(item => (
                  <div key={item.id} className={`p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${item.risk === 'high' ? 'bg-red-50/30' : item.risk === 'medium' ? 'bg-amber-50/20' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        item.qaStatus === 'Sampled' ? 'bg-accent-100 text-accent-700' :
                        item.qaStatus === 'Escalated' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
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
                          <span className="text-[11px] text-foreground-400">{item.module}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.coachStatus === 'Validated' ? 'bg-emerald-100 text-emerald-700' :
                        item.coachStatus === 'Rejected' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>Coach: {item.coachStatus}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.qaStatus === 'Sampled' ? 'bg-accent-100 text-accent-700' :
                        item.qaStatus === 'Escalated' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>QA: {item.qaStatus}</span>
                      <span className="text-[10px] text-foreground-400">{item.submitted}</span>
                      {item.qaStatus === 'Pending' && (
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

        {/* OTJH QA */}
        {activeTab === 'otjh' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH QA Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Verify off-the-job training hours against attendance records and session logs</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingOTJH} pending</span>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {OTJH_QA_ITEMS.map(item => (
                  <div key={item.id} className={`p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${item.risk === 'high' ? 'bg-red-50/30' : ''}`}>
                    <div className={`rounded-lg px-3 py-2 text-center shrink-0 ${item.status === 'Validated' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      <p className="text-xs font-bold">{item.hours}h</p>
                      <p className="text-[9px]">OTJH</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground-900">{item.activity}</p>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{item.learner} · {item.date}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        item.risk === 'high' ? 'bg-red-100 text-red-700' : item.risk === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>{item.risk === 'high' ? 'High Risk' : item.risk === 'medium' ? 'Medium' : 'Low'}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.status === 'Validated' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>{item.status}</span>
                      {item.status === 'Pending' && (
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          Verify
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* KSB QA */}
        {activeTab === 'ksb' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB QA Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Validate KSB claims against evidence quality and sufficiency</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingKSB} pending</span>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {KSB_QA_ITEMS.map(item => (
                  <div key={item.id} className={`p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${item.risk === 'high' ? 'bg-red-50/30' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-secondary-100 text-secondary-700 flex items-center justify-center shrink-0">
                        <AppIcon className="ri-bar-chart-2-line text-sm"></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground-900">{item.ksbRef}</p>
                        <p className="text-[11px] text-foreground-400 mt-0.5">{item.learner} · {item.evidenceCount} evidence item{item.evidenceCount > 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        item.risk === 'high' ? 'bg-red-100 text-red-700' : item.risk === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>{item.risk === 'high' ? 'High Risk' : item.risk === 'medium' ? 'Medium' : 'Low'}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.status === 'Sampled' ? 'bg-accent-100 text-accent-700' : 'bg-amber-100 text-amber-700'
                      }`}>{item.status}</span>
                      {item.status === 'Pending' && (
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          Validate
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Rejected Items */}
        {activeTab === 'rejected' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Rejected Items</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Items rejected during QA — track resubmission and appeals</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{rejectedCount} need resubmission</span>
            </div>
            <div className="space-y-3">
              {REJECTED_ITEMS.map(item => (
                <div key={item.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        item.status === 'Resubmit Required' ? 'bg-red-100 text-red-700' :
                        item.status === 'Appealed' ? 'bg-amber-100 text-amber-700' :
                        'bg-primary-100 text-primary-700'
                      }`}>{item.status}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{item.type}</span>
                    </div>
                    <span className="text-[10px] text-foreground-400">{item.date}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground-900 mb-1">{item.item}</h4>
                  <p className="text-[11px] text-foreground-400 mb-2">{item.learner}</p>
                  <div className="bg-red-50/50 rounded-lg p-3 mb-3">
                    <p className="text-[11px] text-red-700 leading-relaxed">
                      <strong>Reason:</strong> {item.reason}
                    </p>
                    <p className="text-[10px] text-red-500 mt-1">Rejected by: {item.rejectedBy}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-close-circle-line mr-1"></AppIcon> Uphold Rejection
                    </button>
                    <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-check-line mr-1"></AppIcon> Override Accept
                    </button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-message-2-line mr-1"></AppIcon> Message Learner
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Sampling Queue */}
        {activeTab === 'sampling' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Sampling Queue</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Structured sampling for Ofsted readiness — 10-38% sample rates across categories</p>
              </div>
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> New Sample
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {SAMPLING_QUEUE.map(sample => (
                <div key={sample.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      sample.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                      sample.status === 'In Progress' ? 'bg-primary-100 text-primary-700' :
                      'bg-foreground-100 text-foreground-500'
                    }`}>{sample.status}</span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700">{sample.type}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground-900 mb-2">{sample.scope}</h4>
                  <div className="space-y-1 text-[11px] text-foreground-400 mb-3">
                    <p>Total pool: <strong className="text-foreground-700">{sample.total}</strong> items</p>
                    <p>Sampled: <strong className="text-foreground-700">{sample.sampled}</strong> ({sample.percentage}%)</p>
                    {sample.officer !== '—' && <p>QA Officer: <strong className="text-foreground-700">{sample.officer}</strong></p>}
                  </div>
                  <div className="w-full bg-background-200 rounded-full h-1.5 mb-3">
                    <div className={`h-1.5 rounded-full ${sample.status === 'Completed' ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${sample.status === 'Completed' ? 100 : sample.status === 'In Progress' ? 60 : 10}%` }}></div>
                  </div>
                  {sample.status !== 'Completed' && (
                    <button className="w-full px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      {sample.status === 'In Progress' ? 'Continue Review' : 'Start Sampling'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* QA Quick Links */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Evidence QA', icon: 'ri-folder-upload-line' },
            { label: 'OTJH QA', icon: 'ri-time-line' },
            { label: 'KSB QA', icon: 'ri-bar-chart-2-line' },
            { label: 'Rejected Items', icon: 'ri-close-circle-line' },
            { label: 'Sampling', icon: 'ri-pie-chart-2-line' },
            { label: 'QA Reports', icon: 'ri-file-list-3-line' },
            { label: 'Escalations', icon: 'ri-alert-line' },
            { label: 'QA Findings', icon: 'ri-search-eye-line' },
            { label: 'Module QA', icon: 'ri-stack-line' },
            { label: 'Pre-Active QA', icon: 'ri-user-received-line' },
            { label: 'Progress Review QA', icon: 'ri-file-chart-line' },
            { label: 'Report QA', icon: 'ri-bar-chart-box-line' },
          ].map(link => (
            <button
              key={link.label}
              className="flex items-center gap-2 px-3 py-2.5 bg-background-50 rounded-xl border border-foreground-200/60 text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-700 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap"
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

function QAStatCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
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