import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const supportConfig = roleNavMap.support;

const RESOLVED = [
  { id: 'TKT-0887', subject: 'New tenant onboarding — programme template missing', requester: 'Admin Team', tenant: 'MAN', resolvedBy: 'Layla Moussa', resolvedAt: '10 Jun 2026 15:00', resolution: 'Programme template was not published in global catalogue. Published and re-provisioned.' },
  { id: 'TKT-0884', subject: 'Attendance mode "Self-Paced" not showing in dropdown', requester: 'David Osei', tenant: 'KBC', resolvedBy: 'Ahmed Khalil', resolvedAt: '9 Jun 2026 17:30', resolution: 'Missing configuration flag in cohort settings. Enabled Self-Paced mode for Cohort D.' },
  { id: 'TKT-0880', subject: 'Learner rewards points not credited for club participation', requester: 'Engagement Team', tenant: 'KBC', resolvedBy: 'Ahmed Khalil', resolvedAt: '9 Jun 2026 14:15', resolution: 'Club participation trigger was not linked to points rules engine. Fixed mapping.' },
  { id: 'TKT-0875', subject: 'Employer portal showing outdated apprentice list', requester: 'Mark Johnson (KCC)', tenant: 'KBC', resolvedBy: 'David Osei', resolvedAt: '8 Jun 2026 16:45', resolution: 'Cache issue — cleared employer portal cache and verified sync.' },
  { id: 'TKT-0871', subject: 'Evidence file preview broken for .heic images', requester: 'Emily Watson', tenant: 'KBC', resolvedBy: 'Layla Moussa', resolvedAt: '7 Jun 2026 11:20', resolution: 'Added HEIC to supported preview formats. Deployed update.' },
  { id: 'TKT-0868', subject: 'Monthly cycle report email going to spam', requester: 'Coach Team', tenant: 'LSA', resolvedBy: 'Ahmed Khalil', resolvedAt: '6 Jun 2026 09:00', resolution: 'SPF/DKIM records updated. Email deliverability restored.' },
];

export default function SupportResolved() {
  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Resolved Tickets"
      pageSubtitle={`${RESOLVED.length} tickets resolved this week`}
      userName="Ahmed Khalil"
      userRole="Senior Support Lead"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-background-100">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Recently Resolved</h3>
          </div>
          <div className="divide-y divide-background-100">
            {RESOLVED.map(ticket => (
              <div key={ticket.id} className="p-4 md:p-5 hover:bg-background-50/60 transition-smooth">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-check-double-line text-emerald-600 text-lg"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-800">{ticket.subject}</p>
                        <p className="text-[11px] text-foreground-400 mt-1">
                          {ticket.id} · {ticket.requester} · {ticket.tenant} · Resolved by <span className="font-medium text-foreground-600">{ticket.resolvedBy}</span> · {ticket.resolvedAt}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 p-3 bg-emerald-50/60 rounded-lg border border-emerald-100/50">
                      <p className="text-[11px] text-emerald-700">{ticket.resolution}</p>
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