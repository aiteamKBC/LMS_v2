import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface Escalation {
  id: string;
  employer: string;
  contact: string;
  role: string;
  issue: string;
  category: string;
  severity: 'critical' | 'high' | 'medium';
  status: 'open' | 'in-progress' | 'resolved';
  openedDate: string;
  resolvedDate: string | null;
  assignedTo: string;
  actionLog: string[];
  learnerImpact: number;
}

const ESCALATIONS: Escalation[] = [
  { id: 'esc-01', employer: 'Unilever', contact: 'Sarah Williams', role: 'HR Manager', issue: 'Multiple learners showing attendance decline. Learner James Okonkwo at 68% attendance. Request for workplace support review.', category: 'Attendance', severity: 'high', status: 'in-progress', openedDate: '5 Jun 2026', resolvedDate: null, assignedTo: 'Tom Harrington', actionLog: ['5 Jun: Issue raised by coach', '6 Jun: Initial contact with employer', '7 Jun: Meeting scheduled for 12 Jun'], learnerImpact: 3 },
  { id: 'esc-02', employer: 'Tesco', contact: 'Mark Johnson', role: 'Training Manager', issue: 'Learner Daniel Walsh unreported absence. Concerns about workload affecting apprenticeship commitment.', category: 'Absence', severity: 'high', status: 'open', openedDate: '9 Jun 2026', resolvedDate: null, assignedTo: 'Sarah Chen', actionLog: ['9 Jun: Issue raised via automated alert'], learnerImpact: 1 },
  { id: 'esc-03', employer: 'NHS Trust', contact: 'Dr. Priya Patel', role: 'Learning Lead', issue: 'Learner Maya Kapoor reporting IT issues preventing session attendance. Need IT support coordination.', category: 'Technical', severity: 'medium', status: 'in-progress', openedDate: '7 Jun 2026', resolvedDate: null, assignedTo: 'James Harrington', actionLog: ['7 Jun: IT ticket raised', '8 Jun: IT support contacted learner'], learnerImpact: 1 },
  { id: 'esc-04', employer: 'Barclays', contact: 'Emma Richardson', role: 'Apprenticeship Lead', issue: 'Employer requesting curriculum modification for Software Developer cohort. Need curriculum team involvement.', category: 'Curriculum', severity: 'medium', status: 'open', openedDate: '8 Jun 2026', resolvedDate: null, assignedTo: 'Tom Harrington', actionLog: ['8 Jun: Request received via email'], learnerImpact: 5 },
  { id: 'esc-05', employer: 'KPMG', contact: 'David Foster', role: 'Talent Director', issue: 'Learner Aisha Patel requesting leave of absence for personal reasons. Need compliance review.', category: 'Compliance', severity: 'critical', status: 'in-progress', openedDate: '1 Jun 2026', resolvedDate: null, assignedTo: 'Med Maher', actionLog: ['1 Jun: Leave request submitted', '2 Jun: Compliance review initiated', '3 Jun: Awaiting employer approval'], learnerImpact: 1 },
  { id: 'esc-06', employer: 'PWC', contact: 'Laura Mitchell', role: 'HR Business Partner', issue: 'Employer escalation resolved. Learner support plan implemented and attendance improving.', category: 'Attendance', severity: 'medium', status: 'resolved', openedDate: '28 May 2026', resolvedDate: '6 Jun 2026', assignedTo: 'Tom Harrington', actionLog: ['28 May: Issue raised', '30 May: Employer meeting held', '2 Jun: Support plan implemented', '6 Jun: Resolved — attendance improving'], learnerImpact: 2 },
];

export default function EmployerEscalationsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in-progress' | 'resolved'>('all');
  const filtered = ESCALATIONS.filter(e => statusFilter === 'all' || e.status === statusFilter);
  const openCount = ESCALATIONS.filter(e => e.status === 'open').length;
  const inProgressCount = ESCALATIONS.filter(e => e.status === 'in-progress').length;
  const resolvedCount = ESCALATIONS.filter(e => e.status === 'resolved').length;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Employer Escalations" pageSubtitle="Manage escalated employer issues requiring senior intervention"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Employer Escalations"
          description={`${openCount} open, ${inProgressCount} in-progress, ${resolvedCount} resolved. ${ESCALATIONS.filter(e => e.severity === 'critical').length} critical issues requiring immediate attention.`}
          icon="ri-building-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20business%20meeting%20employer%20escalation%20corporate%20office%20warm%20lighting&width=400&height=160&seq=escalation-01&orientation=landscape"
          imageAlt="Employer Escalations"
          stats={[{ label: 'Open', value: String(openCount), variant: 'danger' }, { label: 'In Progress', value: String(inProgressCount) }, { label: 'Resolved', value: String(resolvedCount) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/call-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-phone-line text-sm"></i> Call Logs
          </button>
          <button onClick={() => navigate('/engagement/email-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-mail-line text-sm"></i> Email Logs
          </button>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-alert-line text-sm"></i> Attendance Risk
          </button>
          <button onClick={() => navigate('/engagement/communication')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-message-2-line text-sm"></i> Communication
          </button>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {(['all', 'open', 'in-progress', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${f === 'open' ? 'ri-error-warning-line' : f === 'in-progress' ? 'ri-time-line' : f === 'resolved' ? 'ri-check-line' : 'ri-list-check'} text-sm`}></i>
              {f === 'all' ? 'All' : f === 'in-progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map(esc => (
            <div key={esc.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${esc.severity === 'critical' ? 'border-red-200/50 bg-red-50/20' : esc.severity === 'high' ? 'border-amber-200/50 bg-amber-50/20' : 'border-foreground-200/60'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${esc.severity === 'critical' ? 'bg-red-100 text-red-700' : esc.severity === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{esc.employer.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground-900">{esc.employer}</p>
                    <p className="text-[10px] text-foreground-400">{esc.contact} &middot; {esc.role} &middot; Assigned: {esc.assignedTo}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                  <span className="text-foreground-400">{esc.learnerImpact} learners</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${esc.severity === 'critical' ? 'bg-red-100 text-red-700' : esc.severity === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{esc.severity.toUpperCase()}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${esc.status === 'open' ? 'bg-red-100 text-red-700' : esc.status === 'in-progress' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{esc.status}</span>
                  <span className="text-foreground-400">Opened: {esc.openedDate}</span>
                  {esc.resolvedDate && <span className="text-[10px] text-emerald-600 font-medium">Resolved: {esc.resolvedDate}</span>}
                </div>
              </div>
              <div className="mt-3 bg-background-100/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <i className="ri-information-line text-foreground-400 text-sm mt-0.5"></i>
                  <div className="flex-1">
                    <p className="text-[11px] text-foreground-700 mb-1"><strong className="text-foreground-900">Issue:</strong> {esc.issue}</p>
                    <div className="space-y-1">
                      {esc.actionLog.map((log, i) => (
                        <p key={i} className="text-[10px] text-foreground-400">&bull; {log}</p>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {esc.status !== 'resolved' && (
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-edit-line mr-1"></i> Update
                      </button>
                    )}
                    <button className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-mail-line mr-1"></i> Contact
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}