import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const supportConfig = roleNavMap.support;

const ESCALATED = [
  { id: 'TKT-0885', subject: 'Complaint: AI marking incorrectly rejected valid evidence', requester: 'Rachel Okafor', role: 'Learner', tenant: 'MAN', escalatedBy: 'Layla Moussa', escalatedAt: '10 Jun 2026 11:30', reason: 'Repeated AI validation issue — 3rd complaint this week. Needs investigation of AI model config.', status: 'pending-review' },
  { id: 'TKT-0878', subject: 'CRM Bridge integration causing employer data loss', requester: 'Admin Team', role: 'Super Admin', tenant: 'KBC', escalatedBy: 'Ahmed Khalil', escalatedAt: '9 Jun 2026 15:20', reason: 'Potential data integrity issue — employer records disappearing after sync.', status: 'under-investigation' },
  { id: 'TKT-0872', subject: 'Power BI reports showing incorrect funding figures', requester: 'Finance Director', role: 'Finance', tenant: 'KBC', escalatedBy: 'David Osei', escalatedAt: '8 Jun 2026 09:45', reason: 'Financial data accuracy concern — requires audit and possible data correction.', status: 'pending-review' },
  { id: 'TKT-0865', subject: 'Onboarding portal completely down for 3 hours — SLA breach', requester: 'Enrolment Team', role: 'Enrolment Officer', tenant: 'LSA', escalatedBy: 'Nadia Hussain', escalatedAt: '7 Jun 2026 14:10', reason: 'Service outage affecting new learner onboarding across LSA.', status: 'resolved' },
];

export default function SupportEscalations() {
  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Escalations"
      pageSubtitle="Critical issues requiring investigation or management attention"
      userName="Ahmed Khalil"
      userRole="Senior Support Lead"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-background-100">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Active Escalations ({ESCALATED.filter(e => e.status !== 'resolved').length})</h3>
          </div>
          <div className="divide-y divide-background-100">
            {ESCALATED.map(esc => (
              <div key={esc.id} className="p-4 md:p-5 hover:bg-background-50/60 transition-smooth">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-alert-line text-red-600 text-lg"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-800">{esc.subject}</p>
                        <p className="text-[11px] text-foreground-400 mt-1">{esc.id} · {esc.requester} ({esc.role}) · {esc.tenant}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                        esc.status === 'pending-review' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                        esc.status === 'under-investigation' ? 'bg-red-50 text-red-700 border border-red-200/50' :
                        'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                      }`}>{esc.status.replace(/-/g, ' ')}</span>
                    </div>
                    <div className="mt-2 p-3 bg-red-50/60 rounded-lg border border-red-100/50">
                      <p className="text-[10px] text-foreground-400 mb-1">Escalated by {esc.escalatedBy} · {esc.escalatedAt}</p>
                      <p className="text-[12px] text-red-700">{esc.reason}</p>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-search-eye-line mr-1"></AppIcon> Investigate
                      </button>
                      <button className="px-3 py-1.5 bg-background-100 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-check-line mr-1"></AppIcon> Mark Resolved
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}