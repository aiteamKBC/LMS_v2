import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface AuditLog {
  id: string;
  type: 'Enrolment' | 'Document' | 'Signature' | 'Eligibility' | 'RPL' | 'Evidence';
  action: string;
  learner: string;
  detail: string;
  user: string;
  timestamp: string;
  outcome: 'Passed' | 'Failed' | 'Pending';
}

const AUDIT_LOGS: AuditLog[] = [
  { id: 'AUD-001', type: 'Enrolment', action: 'Enrolment Review Completed', learner: 'Joshua Bennett', detail: 'All enrolment checks passed. Training plan and agreement present. Moving to eligibility.', user: 'Rachel Okonkwo', timestamp: '10 Jun 2026, 10:15', outcome: 'Passed' },
  { id: 'AUD-002', type: 'Eligibility', action: 'Eligibility Review Failed', learner: 'Liam Patel', detail: 'Settled status share code unverifiable. Residency test incomplete.', user: 'Rachel Okonkwo', timestamp: '10 Jun 2026, 09:30', outcome: 'Failed' },
  { id: 'AUD-003', type: 'Document', action: 'Training Plan Uploaded', learner: 'Sophie Martin', detail: 'Training plan v2 uploaded. OTJH calculated at 348 hours over 12 months.', user: 'David Thompson', timestamp: '9 Jun 2026, 16:00', outcome: 'Passed' },
  { id: 'AUD-004', type: 'Signature', action: 'Employer Signature Rejected', learner: 'Ryan Fletcher', detail: 'Sarah Kent rejected apprenticeship agreement — PAYE reference incorrect.', user: 'Sarah Kent', timestamp: '9 Jun 2026, 14:20', outcome: 'Failed' },
  { id: 'AUD-005', type: 'Evidence', action: 'Evidence Pack Audit', learner: 'Chloe Parkinson', detail: '11 of 11 documents verified. Evidence pack complete and QA ready.', user: 'Rachel Okonkwo', timestamp: '9 Jun 2026, 11:45', outcome: 'Passed' },
  { id: 'AUD-006', type: 'RPL', action: 'RPL Assessment Completed', learner: 'Ava Thompson', detail: '5 KSBs exempted. Duration reduced by 2 months. OTJH adjusted to 290 hours.', user: 'Rachel Okonkwo', timestamp: '9 Jun 2026, 10:00', outcome: 'Passed' },
  { id: 'AUD-007', type: 'Document', action: 'Document Missing Flagged', learner: 'Daniel Walsh', detail: 'Training plan and OTJH plan missing from enrolment pack.', user: 'System', timestamp: '8 Jun 2026, 15:30', outcome: 'Failed' },
  { id: 'AUD-008', type: 'Eligibility', action: 'Eligibility Confirmed', learner: 'Sophie Williams', detail: 'All criteria met — age, residency, right to work, employment, DAS ref DAS-001-2026.', user: 'Rachel Okonkwo', timestamp: '8 Jun 2026, 11:00', outcome: 'Passed' },
  { id: 'AUD-009', type: 'Signature', action: 'Learner Declaration Signed', learner: 'Oliver Grant', detail: 'Digital signature verified. Learner declaration accepted.', user: 'Oliver Grant', timestamp: '7 Jun 2026, 16:45', outcome: 'Passed' },
  { id: 'AUD-010', type: 'Enrolment', action: 'New Starter Imported', learner: 'Priya Sharma', detail: 'Converted from NatWest campaign. Assigned to Cohort G, Coach David Thompson.', user: 'System', timestamp: '7 Jun 2026, 09:00', outcome: 'Passed' },
  { id: 'AUD-011', type: 'Evidence', action: 'Evidence Pack Audit', learner: 'Amina Hussein', detail: '4 of 11 documents present. Missing: training plan, OTJH plan, policy docs, employer declaration, IA summary, RPL summary, 1 support doc.', user: 'System', timestamp: '6 Jun 2026, 14:00', outcome: 'Failed' },
  { id: 'AUD-012', type: 'RPL', action: 'RPL Assessment Pending', learner: 'Mia Okonkwo', detail: 'PLR and CV uploaded but skills scan not completed. Diagnostic assessment pending.', user: 'Rachel Okonkwo', timestamp: '5 Jun 2026, 10:30', outcome: 'Pending' },
];

const typeLabels: Record<string, string> = { Enrolment: 'Enrolment Audit', Document: 'Document Audit', Signature: 'Signature Audit', Eligibility: 'Eligibility Audit', RPL: 'RPL Audit', Evidence: 'Evidence Pack Audit' };

export default function AuditReportsPage() {
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = AUDIT_LOGS.filter(l => typeFilter === 'all' || l.type === typeFilter);

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Audit Reports" pageSubtitle="Enrolment audit trail, document audit, signature audit, eligibility audit, RPL audit and evidence pack audit" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Audit Reports" description={`${AUDIT_LOGS.length} audit log entries across 6 categories — enrolment, document, signature, eligibility, RPL and evidence pack audits.`} icon="ri-history-line" imageUrl="https://readdy.ai/api/search-image?query=audit%20log%20compliance%20tracking%20professional%20documentation%20reviewing%20warm%20lighting%20organised%20workspace%20editorial%20photography&width=400&height=160&seq=audit-hero-01&orientation=landscape" imageAlt="Audit reports" stats={[{ label: 'Total Logs', value: String(AUDIT_LOGS.length) }, { label: 'Failed', value: String(AUDIT_LOGS.filter(l => l.outcome === 'Failed').length), variant: 'danger' }, { label: 'Passed', value: String(AUDIT_LOGS.filter(l => l.outcome === 'Passed').length), variant: 'success' }]} />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(['Enrolment', 'Document', 'Signature', 'Eligibility', 'RPL', 'Evidence'] as const).map(t => {
            const count = AUDIT_LOGS.filter(l => l.type === t).length;
            const failed = AUDIT_LOGS.filter(l => l.type === t && l.outcome === 'Failed').length;
            return (
              <button key={t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)} className={`bg-background-50 rounded-xl border p-3.5 text-left cursor-pointer transition-smooth ${typeFilter === t ? 'border-primary-300 bg-primary-50/30' : 'border-background-200/50 hover:border-primary-200/50'}`}>
                <p className="text-[10px] text-foreground-400 mb-1">{typeLabels[t]}</p>
                <p className="text-lg font-heading font-semibold text-foreground-900">{count}</p>
                {failed > 0 && <p className="text-[10px] text-red-600 font-medium">{failed} failed</p>}
              </button>
            );
          })}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Action</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Detail</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">User</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Timestamp</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map(log => (
                  <tr key={log.id} className={`hover:bg-background-100/50 transition-smooth ${log.outcome === 'Failed' ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-3 text-[11px] text-foreground-400 font-mono whitespace-nowrap">{log.id}</td>
                    <td className="px-4 py-3"><span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-secondary-50 text-secondary-600">{log.type}</span></td>
                    <td className="px-4 py-3 text-[12px] font-medium text-foreground-900">{log.action}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{log.learner}</td>
                    <td className="px-4 py-3 text-[11px] text-foreground-500 max-w-[280px] truncate">{log.detail}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-500 whitespace-nowrap">{log.user}</td>
                    <td className="px-4 py-3 text-[11px] text-foreground-400 whitespace-nowrap">{log.timestamp}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        log.outcome === 'Passed' ? 'bg-emerald-50 text-emerald-700' : log.outcome === 'Failed' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                      }`}>{log.outcome}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}