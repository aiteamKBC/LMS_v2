import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface AlertItem {
  id: string;
  learner: string;
  programme: string;
  employer: string;
  issue: string;
  priority: 'red' | 'amber';
  section: string;
  sectionHref: string;
}

interface StatusSection {
  id: string;
  label: string;
  icon: string;
  href: string;
  total: number;
  pending: number;
  blocked: number;
  ready: number;
}

const ALERTS: AlertItem[] = [
  { id: 'alt-1', learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', issue: 'Employer contract overdue by 14 days — funding at risk', priority: 'red', section: 'Employer Contracting', sectionHref: '/compliance/employer-contracting' },
  { id: 'alt-2', learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', issue: 'Eligibility review stalled — right-to-work evidence expired', priority: 'red', section: 'Eligibility', sectionHref: '/compliance/eligibility' },
  { id: 'alt-3', learner: 'Ahmed Khan', programme: 'Accountancy L3', employer: 'Gravesham Borough', issue: 'Employer contract not started after 18 days', priority: 'red', section: 'Employer Contracting', sectionHref: '/compliance/employer-contracting' },
  { id: 'alt-4', learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', issue: 'Enrolment review flagged — training plan and OTJH plan missing', priority: 'red', section: 'Documents', sectionHref: '/compliance/documents' },
  { id: 'alt-5', learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', issue: 'Self-onboarding stalled at 45% — PLR and policy docs not uploaded', priority: 'amber', section: 'Self-Onboarding', sectionHref: '/compliance/self-onboarding' },
  { id: 'alt-6', learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', issue: 'ILR record has 3 missing fields — planned OTJH and TNP1 missing', priority: 'amber', section: 'ILR Readiness', sectionHref: '/compliance/ilr' },
  { id: 'alt-7', learner: 'Hannah Reid', programme: 'Customer Service L2', employer: 'Dartford Borough Council', issue: 'Evidence pack incomplete — employer declaration not signed', priority: 'amber', section: 'Evidence Packs', sectionHref: '/compliance/evidence-packs' },
  { id: 'alt-8', learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', issue: 'DAS reservation not confirmed — awaiting employer approval', priority: 'amber', section: 'DAS Tracker', sectionHref: '/compliance/das' },
];

const STATUS_SECTIONS: StatusSection[] = [
  { id: 'new-starters', label: 'New Starters', icon: 'ri-user-add-line', href: '/compliance/new-starters', total: 14, pending: 4, blocked: 1, ready: 9 },
  { id: 'self-onboarding', label: 'Self-Onboarding', icon: 'ri-user-received-line', href: '/compliance/self-onboarding', total: 6, pending: 4, blocked: 1, ready: 1 },
  { id: 'employer-contracting', label: 'Employer Contracting', icon: 'ri-file-text-line', href: '/compliance/employer-contracting', total: 5, pending: 2, blocked: 2, ready: 1 },
  { id: 'enrolment-review', label: 'Enrolment Review', icon: 'ri-search-eye-line', href: '/compliance/enrolment-review', total: 6, pending: 3, blocked: 0, ready: 3 },
  { id: 'eligibility', label: 'Eligibility', icon: 'ri-checkbox-circle-line', href: '/compliance/eligibility', total: 6, pending: 2, blocked: 1, ready: 3 },
  { id: 'initial-assessment', label: 'Initial Assessment', icon: 'ri-clipboard-line', href: '/compliance/initial-assessment', total: 6, pending: 1, blocked: 0, ready: 5 },
  { id: 'rpl-review', label: 'RPL Review', icon: 'ri-file-search-line', href: '/compliance/rpl-review', total: 6, pending: 1, blocked: 0, ready: 5 },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line', href: '/compliance/documents', total: 28, pending: 4, blocked: 2, ready: 22 },
  { id: 'signatures', label: 'Digital Signatures', icon: 'ri-pen-nib-line', href: '/compliance/signatures', total: 12, pending: 3, blocked: 2, ready: 7 },
  { id: 'evidence-packs', label: 'Evidence Packs', icon: 'ri-folder-upload-line', href: '/compliance/evidence-packs', total: 14, pending: 2, blocked: 1, ready: 11 },
  { id: 'das', label: 'DAS Tracker', icon: 'ri-money-pound-circle-line', href: '/compliance/das', total: 14, pending: 3, blocked: 1, ready: 10 },
  { id: 'ilr', label: 'ILR Readiness', icon: 'ri-database-2-line', href: '/compliance/ilr', total: 14, pending: 3, blocked: 2, ready: 9 },
  { id: 'funding-risk', label: 'Funding Risk', icon: 'ri-alert-line', href: '/compliance/funding-risk', total: 14, pending: 4, blocked: 2, ready: 8 },
  { id: 'aptem-sync', label: 'Aptem Sync', icon: 'ri-refresh-line', href: '/compliance/aptem-sync', total: 14, pending: 1, blocked: 0, ready: 13 },
];

const RECENT_ACTIVITY = [
  { action: 'Contract signed', learner: 'Joshua Bennett', detail: 'Business Admin L3 — Canterbury City Council. Signatory: David Thompson. DAS ref: DAS-002-2026.', time: '11 Jun 2026, 09:45', type: 'approved' },
  { action: 'Eligibility rejected', learner: 'Liam Patel', detail: 'Data Analyst L4 — Costa Coffee. Settled status share code unverifiable. Returned to onboarding.', time: '10 Jun 2026, 16:20', type: 'rejected' },
  { action: 'New starter imported', learner: 'Priya Sharma', detail: 'Business Admin L3 — NatWest. Converted from campaign. Assigned to Cohort G.', time: '10 Jun 2026, 14:10', type: 'new' },
  { action: 'ILR errors flagged', learner: 'Sophie Martin', detail: 'Marketing Executive L4 — Tim Hortons. 3 missing fields: Planned OTJH, TNP1, Employer ID format.', time: '10 Jun 2026, 11:30', type: 'action' },
  { action: 'RPL approved', learner: 'Ava Thompson', detail: 'Ops Manager L5 — M&S. 5 KSBs exempted. Duration reduced by 2 months. OTJH adjusted.', time: '9 Jun 2026, 15:00', type: 'approved' },
  { action: 'Evidence pack completed', learner: 'Chloe Parkinson', detail: 'Early Years Educator L3 — Ashford Nursery. All 11 documents verified. Ready for QA.', time: '9 Jun 2026, 10:15', type: 'completed' },
  { action: 'DAS confirmed', learner: 'Emily Chen', detail: 'Business Admin L3 — Boots UK. Levy funded. Reservation ID: RES-004-2026.', time: '8 Jun 2026, 16:45', type: 'approved' },
  { action: 'Signature rejected', learner: 'Ryan Fletcher', detail: 'Software Developer L4 — Kent Fire & Rescue. Employer signature expired. Regenerated document.', time: '8 Jun 2026, 09:20', type: 'rejected' },
];

function getPrioritySummary(sections: StatusSection[]) {
  const totalBlocked = sections.reduce((s, sec) => s + sec.blocked, 0);
  const totalPending = sections.reduce((s, sec) => s + sec.pending, 0);
  const totalReady = sections.reduce((s, sec) => s + sec.ready, 0);
  const totalLearners = sections[0].total;
  const redAlerts = ALERTS.filter(a => a.priority === 'red').length;
  const amberAlerts = ALERTS.filter(a => a.priority === 'amber').length;
  return { totalBlocked, totalPending, totalReady, totalLearners, redAlerts, amberAlerts };
}

export default function EnrolmentDashboard() {
  const [expandedAlert, setExpandedAlert] = useState(false);
  const summary = getPrioritySummary(STATUS_SECTIONS);

  return (
    <WorkspaceShell
      role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel}
      pageTitle="Enrolment Command Centre" pageSubtitle="Onboarding, eligibility, documents, funding-readiness and learner activation oversight"
      userName="Rachel Okonkwo" userRole="Enrolment Officer"
    >
      <div className="p-6 space-y-5">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Enrolment Command Centre"
          description={`${summary.totalLearners} learners in onboarding pipeline. ${summary.totalBlocked} urgent blockers, ${summary.totalPending} needing attention, ${summary.totalReady} on track. ${summary.redAlerts} critical alerts require immediate action.`}
          icon="ri-user-star-line"
          imageUrl="https://readdy.ai/api/search-image?query=professional%20modern%20enrolment%20onboarding%20office%20workspace%20warm%20natural%20light%20organised%20documents%20clean%20aesthetic%20editorial%20photography&width=400&height=160&seq=enrolment-hero-01&orientation=landscape"
          imageAlt="Enrolment command centre"
          stats={[
            { label: 'In Pipeline', value: String(summary.totalLearners) },
            { label: 'Blocked', value: String(summary.totalBlocked), variant: 'danger' },
            { label: 'Ready', value: String(summary.totalReady), variant: 'success' },
          ]}
        />

        {/* Critical Alerts Banner */}
        {ALERTS.filter(a => a.priority === 'red').length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                  <AppIcon className="ri-alert-fill text-white text-sm"></AppIcon>
                </span>
                <div>
                  <p className="text-sm font-heading font-semibold text-red-800">{summary.redAlerts} Critical Blockers Requiring Immediate Action</p>
                  <p className="text-[11px] text-red-600 mt-0.5">Funding at risk if not resolved — DAS, ILR, eligibility and contracting issues flagged</p>
                </div>
              </div>
              <button
                onClick={() => setExpandedAlert(!expandedAlert)}
                className="text-[12px] text-red-700 hover:text-red-800 font-medium whitespace-nowrap flex items-center gap-1 cursor-pointer"
              >
                {expandedAlert ? 'Collapse' : 'View All'} {expandedAlert ? <AppIcon className="ri-arrow-up-s-line"></AppIcon> : <AppIcon className="ri-arrow-down-s-line"></AppIcon>}
              </button>
            </div>
            {expandedAlert && (
              <div className="mt-3 space-y-2">
                {ALERTS.filter(a => a.priority === 'red').map(alert => (
                  <a key={alert.id} href={alert.sectionHref} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-red-100 hover:border-red-300 transition-smooth cursor-pointer block">
                    <span className="w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold">{alert.learner.charAt(0)}</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-foreground-900">{alert.learner} — {alert.programme}</p>
                      <p className="text-[11px] text-red-600">{alert.issue}</p>
                    </div>
                    <span className="text-[10px] text-foreground-400 bg-foreground-100 px-2 py-0.5 rounded-full whitespace-nowrap">{alert.section}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Amber Alerts */}
        {ALERTS.filter(a => a.priority === 'amber').length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                <AppIcon className="ri-error-warning-fill text-white text-sm"></AppIcon>
              </span>
              <div>
                <p className="text-sm font-heading font-semibold text-amber-800">{summary.amberAlerts} Items Needing Attention</p>
                <p className="text-[11px] text-amber-600 mt-0.5">Self-onboarding progress, ILR fields, evidence pack gaps and DAS confirmations pending</p>
              </div>
            </div>
          </div>
        )}

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {STATUS_SECTIONS.map(section => {
            const hasBlocked = section.blocked > 0;
            const hasPending = section.pending > 0;
            return (
              <a
                key={section.id}
                href={section.href}
                className={`bg-background-50 rounded-xl border p-3.5 cursor-pointer block transition-smooth hover:border-primary-200/50 ${
                  hasBlocked ? 'border-red-200/70 bg-red-50/20' : hasPending ? 'border-amber-200/50 bg-amber-50/15' : 'border-foreground-200/60'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    hasBlocked ? 'bg-red-100 text-red-600' : hasPending ? 'bg-amber-100 text-amber-600' : 'bg-primary-100 text-primary-600'
                  }`}>
                    <AppIcon className={`${section.icon} text-xs`}></AppIcon>
                  </span>
                  {hasBlocked && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>}
                  {hasPending && !hasBlocked && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>}
                </div>
                <p className="text-[11px] text-foreground-400">{section.label}</p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <p className="text-lg font-heading font-semibold text-foreground-900">{section.total}</p>
                  {section.blocked > 0 && <span className="text-[10px] text-red-600 font-medium">{section.blocked} blocked</span>}
                  {section.pending > 0 && <span className="text-[10px] text-amber-600 font-medium">{section.pending} pending</span>}
                </div>
              </a>
            );
          })}
        </div>

        {/* Pipeline Overview & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Pipeline Summary */}
          <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Onboarding Pipeline Overview</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">14 learners progressing through 15-stage onboarding journey</p>
              </div>
              <Link to="/compliance/pre-active" className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap">
                Full Journey <AppIcon className="ri-arrow-right-line ml-1"></AppIcon>
              </Link>
            </div>
            <div className="space-y-2">
              {[
                { stage: 'New Starter', count: 14, icon: 'ri-user-add-line', color: 'bg-primary-500' },
                { stage: 'Self-Onboarding', count: 6, icon: 'ri-user-received-line', color: 'bg-accent-500' },
                { stage: 'Employer Contracting', count: 5, icon: 'ri-file-text-line', color: 'bg-red-500' },
                { stage: 'Enrolment Review', count: 6, icon: 'ri-search-eye-line', color: 'bg-amber-500' },
                { stage: 'Eligibility', count: 6, icon: 'ri-checkbox-circle-line', color: 'bg-secondary-500' },
                { stage: 'Initial Assessment', count: 6, icon: 'ri-clipboard-line', color: 'bg-primary-500' },
                { stage: 'RPL Review', count: 6, icon: 'ri-file-search-line', color: 'bg-accent-500' },
                { stage: 'Documents', count: 6, icon: 'ri-folder-line', color: 'bg-secondary-500' },
                { stage: 'Signatures', count: 4, icon: 'ri-pen-nib-line', color: 'bg-amber-500' },
                { stage: 'DAS Tracker', count: 4, icon: 'ri-money-pound-circle-line', color: 'bg-primary-500' },
                { stage: 'ILR Readiness', count: 3, icon: 'ri-database-2-line', color: 'bg-red-500' },
                { stage: 'Evidence Pack', count: 3, icon: 'ri-folder-upload-line', color: 'bg-accent-500' },
                { stage: 'QA Ready', count: 3, icon: 'ri-shield-check-line', color: 'bg-secondary-500' },
                { stage: 'Activation', count: 2, icon: 'ri-rocket-line', color: 'bg-emerald-500' },
                { stage: 'Active Learner', count: 24, icon: 'ri-user-star-line', color: 'bg-emerald-500' },
              ].map((s, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.color}`}></span>
                  <span className="text-[12px] text-foreground-700 flex-1">{s.stage}</span>
                  <span className="text-[12px] font-semibold text-foreground-900">{s.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Recent Activity</h3>
              <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">Last 3 days</span>
            </div>
            <div className="space-y-3">
              {RECENT_ACTIVITY.map((act, i) => (
                <div key={i} className="flex gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    act.type === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                    act.type === 'rejected' ? 'bg-red-100 text-red-600' :
                    act.type === 'action' ? 'bg-amber-100 text-amber-600' :
                    act.type === 'new' ? 'bg-blue-100 text-blue-600' :
                    'bg-primary-100 text-primary-600'
                  }`}>
                    <AppIcon className={`${
                      act.type === 'approved' ? 'ri-check-line' :
                      act.type === 'rejected' ? 'ri-close-line' :
                      act.type === 'action' ? 'ri-alert-line' :
                      act.type === 'new' ? 'ri-add-line' :
                      'ri-file-list-3-line'
                    } text-[10px]`}></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-foreground-900 leading-tight">
                      <strong>{act.action}</strong> — {act.learner}
                    </p>
                    <p className="text-[10px] text-foreground-400 mt-0.5 leading-tight">{act.detail}</p>
                    <p className="text-[10px] text-foreground-300 mt-0.5">{act.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Messages requiring action */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                <AppIcon className="ri-mail-unread-line text-sm"></AppIcon>
              </span>
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Messages Requiring Enrolment Team Action</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">3 unread messages from coaches, employers and MIS team</p>
              </div>
            </div>
            <Link to="/messages" className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap">
              Open Messages <AppIcon className="ri-arrow-right-line ml-1"></AppIcon>
            </Link>
          </div>
          <div className="space-y-2">
            {[
              { from: 'David Thompson (Coach)', subject: 'Re: Joshua Bennett — Training Plan Approval Needed', preview: 'Hi Rachel, the training plan for Joshua is ready for enrolment review. Can you check the OTJH calculation...', time: '10 Jun, 14:30', unread: true },
              { from: 'Sarah Kent (Employer)', subject: 'Ryan Fletcher — Contract Query', preview: 'We have received the apprenticeship agreement but the PAYE reference on page 3 appears incorrect. Please can you verify...', time: '9 Jun, 11:15', unread: true },
              { from: 'MIS Data Team', subject: 'ILR Batch Validation — 3 Warnings for Cohort G', preview: 'The latest ILR batch upload shows 3 validation warnings for learners in Cohort G. Planned OTJH fields are missing...', time: '9 Jun, 09:00', unread: true },
              { from: 'QA Team', subject: 'Eligibility QA Passed — Batch of 4', preview: 'QA review completed for batch ENR-2026-042. 4 of 4 eligibility cases passed. Releasing to next stage...', time: '8 Jun, 16:45', unread: false },
            ].map((msg, i) => (
              <Link key={i} to="/messages" className={`flex items-start gap-3 p-3 rounded-lg transition-smooth cursor-pointer block ${msg.unread ? 'bg-primary-50/50 border border-primary-100/50' : 'hover:bg-background-100/50'}`}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${msg.unread ? 'bg-primary-100 text-primary-700' : 'bg-foreground-100 text-foreground-400'}`}>
                  {msg.from.charAt(0)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] font-semibold text-foreground-900">{msg.from}</p>
                    {msg.unread && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>}
                  </div>
                  <p className="text-[12px] font-medium text-foreground-700 mt-0.5">{msg.subject}</p>
                  <p className="text-[11px] text-foreground-400 mt-0.5 truncate">{msg.preview}</p>
                </div>
                <span className="text-[10px] text-foreground-300 shrink-0">{msg.time}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}