import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { auditorNavItems } from '@/mocks/navigation';
import { roleNavMap } from '@/mocks/navigation';

const auditorConfig = roleNavMap.auditor;

const STATS = [
  { label: 'Evidence Samples', value: '24', icon: 'ri-folder-open-line', subtitle: 'Across 6 programmes', colour: 'primary' },
  { label: 'Audit Trail Entries', value: '1,847', icon: 'ri-history-line', subtitle: 'Last 12 months', colour: 'accent' },
  { label: 'Compliance Flags', value: '3', icon: 'ri-flag-line', subtitle: '2 resolved · 1 open', colour: 'red' },
  { label: 'Ofsted Evidence Pack', value: 'Ready', icon: 'ri-government-line', subtitle: 'Last updated: 02 Jun', colour: 'emerald' },
];

const RECENT_AUDIT_ENTRIES = [
  { id: 'AUD-1042', action: 'Evidence Validated', user: 'Helen Curtis', entity: 'Evidence #EV-2881', date: '09 Jun 2026 14:22', type: 'validation' },
  { id: 'AUD-1038', action: 'Progress Review Signed', user: 'James Thompson', entity: 'Review #PR-542', date: '08 Jun 2026 11:05', type: 'signature' },
  { id: 'AUD-1035', action: 'OTJH Entry Validated', user: 'Martin Reeves', entity: 'OTJH #OT-1204', date: '07 Jun 2026 16:40', type: 'validation' },
  { id: 'AUD-1031', action: 'Learner Record Updated', user: 'Lisa Nguyen', entity: 'User Sophie Williams', date: '06 Jun 2026 09:15', type: 'edit' },
  { id: 'AUD-1028', action: 'QA Spot Check Passed', user: 'Tom Bradley', entity: 'Cohort B Evidence Sample', date: '05 Jun 2026 15:30', type: 'qa' },
  { id: 'AUD-1024', action: 'Compliance Document Signed', user: 'Rebecca Holmes', entity: 'DAS Confirmation', date: '04 Jun 2026 10:00', type: 'signature' },
  { id: 'AUD-1020', action: 'Enrolment Approved', user: 'Rebecca Holmes', entity: 'Learner Joshua Bennett', date: '03 Jun 2026 13:45', type: 'approval' },
  { id: 'AUD-1017', action: 'Evidence Flagged for Review', user: 'Tom Bradley', entity: 'Evidence #EV-2744', date: '02 Jun 2026 11:20', type: 'qa' },
];

const EVIDENCE_SAMPLES = [
  { id: 'EV-2881', learner: 'Sophie Williams', programme: 'Marketing Executive L4', type: 'Reflection', status: 'Validated', date: '09 Jun' },
  { id: 'EV-2744', learner: 'Daniel Walsh', programme: 'Business Admin L3', type: 'OTJH Log', status: 'Flagged', date: '08 Jun' },
  { id: 'EV-2612', learner: 'Aisha Patel', programme: 'Software Dev L4', type: 'Assignment', status: 'Validated', date: '07 Jun' },
  { id: 'EV-2598', learner: 'Mia Okonkwo', programme: 'Marketing Executive L4', type: 'Work Product', status: 'In Review', date: '06 Jun' },
  { id: 'EV-2487', learner: 'Oliver Grant', programme: 'Business Admin L3', type: 'Video Evidence', status: 'Validated', date: '05 Jun' },
];

export default function AuditorWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'audit' | 'samples' | 'compliance'>('overview');

  return (
    <WorkspaceShell
      role="auditor"
      roleLabel={auditorConfig.label}
      navItems={auditorConfig.items}
      pageTitle="Auditor Workspace"
      pageSubtitle="External audit evidence sampling and compliance review"
      userName="Patricia Stone"
      userRole="External Auditor"
      workspaceLabel={auditorConfig.workspaceLabel}
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Auditor Workspace"
          description="External audit evidence sampling, compliance review, audit trail monitoring and Ofsted evidence pack management"
          icon="ri-folder-open-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20audit%20compliance%20documentation%20evidence%20files%20professional%20auditor%20purple%20gold%20accent%20editorial%20photography%20modern%20clean%20minimalist%20corporate&width=400&height=160&seq=auditor-hero-01&orientation=landscape"
          imageAlt="Auditor Workspace"
          stats={[
            { label: 'Evidence Samples', value: '24' },
            { label: 'Audit Entries', value: '1,847' },
            { label: 'Flags', value: '3', variant: 'danger' },
          ]}
        />
        {/* Stats Banner */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="bg-background-50 border border-foreground-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  stat.colour === 'primary' ? 'bg-primary-50 text-primary-600' :
                  stat.colour === 'accent' ? 'bg-accent-50 text-accent-600' :
                  stat.colour === 'red' ? 'bg-red-50 text-red-600' :
                  'bg-emerald-50 text-emerald-600'
                }`}>
                  <i className={`${stat.icon} text-xs`}></i>
                </span>
              </div>
              <p className="text-2xl font-heading font-semibold text-foreground-950">{stat.value}</p>
              <p className="text-[11px] text-foreground-500 mt-1">{stat.label}</p>
              <p className="text-[10px] text-foreground-400 mt-0.5">{stat.subtitle}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit">
          {(['overview', 'audit', 'samples', 'compliance'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {tab === 'overview' ? 'Overview' : tab === 'audit' ? 'Audit Trail' : tab === 'samples' ? 'Evidence Samples' : 'Compliance Review'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Audit Trail Table */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-background-100">
                <h3 className="text-[14px] font-heading font-semibold text-foreground-900">Recent Audit Trail</h3>
                <a href="/auditor/trail" className="text-[12px] text-primary-600 font-medium hover:text-primary-700">Full trail</a>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                    <th className="text-left px-5 py-2.5 font-medium">ID</th>
                    <th className="text-left px-5 py-2.5 font-medium">Action</th>
                    <th className="text-left px-5 py-2.5 font-medium">Entity</th>
                    <th className="text-left px-5 py-2.5 font-medium">User</th>
                    <th className="text-right px-5 py-2.5 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {RECENT_AUDIT_ENTRIES.map((entry) => (
                    <tr key={entry.id} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                      <td className="px-5 py-3 text-foreground-400 font-mono text-[11px]">{entry.id}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            entry.type === 'validation' ? 'bg-emerald-500' :
                            entry.type === 'signature' ? 'bg-primary-500' :
                            entry.type === 'qa' ? 'bg-amber-500' :
                            entry.type === 'approval' ? 'bg-accent-500' :
                            'bg-foreground-300'
                          }`}></span>
                          <span className="text-foreground-800">{entry.action}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-foreground-700">{entry.entity}</td>
                      <td className="px-5 py-3 text-foreground-600">{entry.user}</td>
                      <td className="px-5 py-3 text-right text-foreground-400 text-[11px]">{entry.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Evidence Samples */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-background-100">
                <h3 className="text-[14px] font-heading font-semibold text-foreground-900">Evidence Samples</h3>
                <a href="/auditor/evidence" className="text-[12px] text-primary-600 font-medium hover:text-primary-700">All samples</a>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                    <th className="text-left px-5 py-2.5 font-medium">Evidence ID</th>
                    <th className="text-left px-5 py-2.5 font-medium">Learner</th>
                    <th className="text-left px-5 py-2.5 font-medium">Programme</th>
                    <th className="text-left px-5 py-2.5 font-medium">Type</th>
                    <th className="text-right px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {EVIDENCE_SAMPLES.map((ev) => (
                    <tr key={ev.id} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                      <td className="px-5 py-3 text-foreground-400 font-mono text-[11px]">{ev.id}</td>
                      <td className="px-5 py-3 text-foreground-800 font-medium">{ev.learner}</td>
                      <td className="px-5 py-3 text-foreground-700">{ev.programme}</td>
                      <td className="px-5 py-3 text-foreground-600">{ev.type}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          ev.status === 'Validated' ? 'bg-emerald-50 text-emerald-700' :
                          ev.status === 'Flagged' ? 'bg-red-50 text-red-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>{ev.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Quick Actions */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl p-5">
              <h3 className="text-[14px] font-heading font-semibold text-foreground-900 mb-3">Audit Actions</h3>
              <div className="space-y-2">
                {[
                  { label: 'Request Evidence Sample', icon: 'ri-folder-open-line' },
                  { label: 'Export Full Audit Trail', icon: 'ri-download-line' },
                  { label: 'Generate Audit Report', icon: 'ri-file-text-line' },
                  { label: 'Ofsted Evidence Pack', icon: 'ri-government-line' },
                ].map((action) => (
                  <button key={action.label} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer">
                    <i className={`${action.icon} text-foreground-400`}></i>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Audit Summary */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl p-5">
              <h3 className="text-[14px] font-heading font-semibold text-foreground-900 mb-3">Audit Period Summary</h3>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-foreground-500">Period</span>
                  <span className="text-foreground-800 font-medium">01 Apr - 10 Jun 2026</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-500">Total Actions</span>
                  <span className="text-foreground-800 font-medium">1,847</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-500">Validations</span>
                  <span className="text-emerald-700 font-medium">842</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-500">Signatures</span>
                  <span className="text-primary-700 font-medium">314</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-500">QA Reviews</span>
                  <span className="text-amber-700 font-medium">156</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-500">Flagged Items</span>
                  <span className="text-red-700 font-medium">3</span>
                </div>
              </div>
            </div>

            {/* Compliance Status */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl p-5">
              <h3 className="text-[14px] font-heading font-semibold text-foreground-900 mb-3">Compliance Status</h3>
              <div className="space-y-2.5">
                {[
                  { label: 'DAS Records', status: 'Compliant', color: 'emerald' },
                  { label: 'ILR Submissions', status: 'Compliant', color: 'emerald' },
                  { label: 'Evidence Retention', status: 'Compliant', color: 'emerald' },
                  { label: 'Signature Records', status: 'Review Needed', color: 'amber' },
                  { label: 'GDPR Data Handling', status: 'Compliant', color: 'emerald' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-[12px] text-foreground-600">{item.label}</span>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      item.color === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}