import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const auditorConfig = roleNavMap.auditor;

interface ComplianceItem {
  id: string;
  category: 'DAS' | 'ILR' | 'Evidence' | 'Safeguarding' | 'GDPR' | 'Funding' | 'Signatures' | 'Ofsted';
  requirement: string;
  description: string;
  status: 'Compliant' | 'Partial' | 'Non-Compliant' | 'Not Applicable';
  lastChecked: string;
  checkedBy: string;
  evidenceRef: string;
  notes: string;
}

const COMPLIANCE_ITEMS: ComplianceItem[] = [
  { id: 'COM-001', category: 'DAS', requirement: 'Valid DAS Agreement', description: 'All learners must have an active Digital Apprenticeship Service agreement with confirmed funding commitment', status: 'Compliant', lastChecked: '10 Jun 2026', checkedBy: 'Rebecca Holmes', evidenceRef: 'DAS-1182', notes: 'All 87 learners have valid DAS agreements. Quarterly review passed.' },
  { id: 'COM-002', category: 'DAS', requirement: 'Funding Band Compliance', description: 'Learner funding must not exceed the published funding band maximum for each standard', status: 'Compliant', lastChecked: '09 Jun 2026', checkedBy: 'Rebecca Holmes', evidenceRef: 'DAS-1178', notes: 'No over-funding identified. All learners within band.' },
  { id: 'COM-003', category: 'ILR', requirement: 'ILR Submission Accuracy', description: 'Individualised Learner Record data must be accurate and submitted within ESFA deadlines', status: 'Compliant', lastChecked: '07 Jun 2026', checkedBy: 'Lisa Nguyen', evidenceRef: 'ILR-2026-Q2', notes: 'Q2 submission passed with 0 validation errors. 87 records confirmed.' },
  { id: 'COM-004', category: 'ILR', requirement: 'Planned Hours Declaration', description: 'Planned off-the-job training hours must be declared and match the programme duration', status: 'Compliant', lastChecked: '07 Jun 2026', checkedBy: 'Lisa Nguyen', evidenceRef: 'ILR-2026-Q2', notes: 'All planned hours declarations verified against programme specifications.' },
  { id: 'COM-005', category: 'Evidence', requirement: 'Evidence Retention Policy', description: 'All learner evidence must be retained for minimum 6 years post-completion per ESFA rules', status: 'Compliant', lastChecked: '08 Jun 2026', checkedBy: 'Tom Bradley', evidenceRef: 'QA-RPT-045', notes: 'Evidence retention confirmed. Oldest records from Sep 2024 cohort still accessible.' },
  { id: 'COM-006', category: 'Evidence', requirement: 'KSB Evidence Coverage', description: 'Every KSB component must have at least one piece of validated evidence before gateway', status: 'Partial', lastChecked: '10 Jun 2026', checkedBy: 'Patricia Stone', evidenceRef: 'AUD-SMP-12', notes: '3 learners in PM-L4 cohort have incomplete KSB evidence: K5, S8 and B4 gaps identified.' },
  { id: 'COM-007', category: 'Safeguarding', requirement: 'DSL Appointment', description: 'A designated safeguarding lead must be appointed and registered with the organisation', status: 'Compliant', lastChecked: '05 Jun 2026', checkedBy: 'Dr. Helen Park', evidenceRef: 'SG-POL-001', notes: 'DSL: Dr. Helen Park. Deputy DSL: James Porter. Both DBS checked and trained.' },
  { id: 'COM-008', category: 'Safeguarding', requirement: 'Prevent Duty Compliance', description: 'Staff must complete Prevent duty training and learners must receive British values education', status: 'Compliant', lastChecked: '05 Jun 2026', checkedBy: 'Dr. Helen Park', evidenceRef: 'SG-TRN-022', notes: '100% staff Prevent training complete. British values embedded in all programmes.' },
  { id: 'COM-009', category: 'GDPR', requirement: 'Data Processing Records', description: 'Records of all data processing activities must be maintained per UK GDPR Article 30', status: 'Compliant', lastChecked: '06 Jun 2026', checkedBy: 'Rebecca Holmes', evidenceRef: 'GDPR-ROPA-2026', notes: 'ROPA updated Q1 2026. All processors listed with lawful basis.' },
  { id: 'COM-010', category: 'GDPR', requirement: 'Subject Access Request Process', description: 'A documented process must exist for handling subject access requests within 30 days', status: 'Compliant', lastChecked: '06 Jun 2026', checkedBy: 'Rebecca Holmes', evidenceRef: 'GDPR-POL-003', notes: 'SAR policy in place. 2 requests handled in last 12 months, both within SLA.' },
  { id: 'COM-011', category: 'Funding', requirement: 'Co-Investment Monitoring', description: 'Co-investment contributions from employers must be tracked and collected per funding rules', status: 'Compliant', lastChecked: '09 Jun 2026', checkedBy: 'Rebecca Holmes', evidenceRef: 'FIN-COI-002', notes: 'All employer co-investment payments up to date. No outstanding balances.' },
  { id: 'COM-012', category: 'Funding', requirement: 'Withdrawal Impact Assessment', description: 'Learner withdrawals must be assessed for funding impact and reported to ESFA within deadlines', status: 'Partial', lastChecked: '08 Jun 2026', checkedBy: 'Rebecca Holmes', evidenceRef: 'FIN-WTH-004', notes: '2 withdrawals in Q2 not yet reported to ESFA. Deadline: 14 Jun 2026.' },
  { id: 'COM-013', category: 'Signatures', requirement: 'Apprenticeship Agreement Signed', description: 'Tripartite apprenticeship agreement must be signed by learner, employer, and provider', status: 'Partial', lastChecked: '10 Jun 2026', checkedBy: 'Patricia Stone', evidenceRef: 'SIG-CHK-18', notes: '4 of 87 learners have unsigned agreements. All from May/Jun 2026 starters — within grace period.' },
  { id: 'COM-014', category: 'Signatures', requirement: 'Training Plan Signed', description: 'Individual training plan must be signed and dated within 6 weeks of programme start', status: 'Compliant', lastChecked: '10 Jun 2026', checkedBy: 'Patricia Stone', evidenceRef: 'SIG-CHK-19', notes: 'All training plans signed within required timeframe. No overdue signatures.' },
  { id: 'COM-015', category: 'Ofsted', requirement: 'Inspection Readiness Pack', description: 'Ofsted evidence pack must be maintained and updated at least quarterly', status: 'Compliant', lastChecked: '02 Jun 2026', checkedBy: 'Dr. Helen Park', evidenceRef: 'OFS-PACK-2026', notes: 'Ofsted pack last updated 2 Jun. Next review scheduled 2 Sep 2026.' },
  { id: 'COM-016', category: 'Ofsted', requirement: 'Safeguarding Evidence File', description: 'Dedicated safeguarding evidence file must be maintained for Ofsted inspection', status: 'Compliant', lastChecked: '05 Jun 2026', checkedBy: 'Dr. Helen Park', evidenceRef: 'SG-EVID-012', notes: 'Safeguarding evidence file complete. Includes case logs, training records, and policy docs.' },
];

const statusColour = (s: ComplianceItem['status']) => {
  switch (s) {
    case 'Compliant': return 'bg-emerald-100 text-emerald-700';
    case 'Partial': return 'bg-amber-100 text-amber-700';
    case 'Non-Compliant': return 'bg-red-100 text-red-700';
    case 'Not Applicable': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

const categoryColour = (c: ComplianceItem['category']) => {
  switch (c) {
    case 'DAS': return 'bg-primary-100 text-primary-700';
    case 'ILR': return 'bg-accent-100 text-accent-700';
    case 'Evidence': return 'bg-secondary-100 text-secondary-700';
    case 'Safeguarding': return 'bg-rose-100 text-rose-700';
    case 'GDPR': return 'bg-violet-100 text-violet-700';
    case 'Funding': return 'bg-amber-100 text-amber-700';
    case 'Signatures': return 'bg-emerald-100 text-emerald-700';
    case 'Ofsted': return 'bg-cyan-100 text-cyan-700';
    default: return '';
  }
};

export default function AuditorCompliancePage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = COMPLIANCE_ITEMS.filter(c => {
    const matchSearch = c.requirement.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || c.status === filterStatus;
    const matchCategory = filterCategory === 'All' || c.category === filterCategory;
    return matchSearch && matchStatus && matchCategory;
  });

  const compliantCount = COMPLIANCE_ITEMS.filter(c => c.status === 'Compliant').length;
  const partialCount = COMPLIANCE_ITEMS.filter(c => c.status === 'Partial').length;
  const nonCompliantCount = COMPLIANCE_ITEMS.filter(c => c.status === 'Non-Compliant').length;

  return (
    <WorkspaceShell role="auditor" roleLabel={auditorConfig.label} navItems={auditorConfig.items} workspaceLabel={auditorConfig.workspaceLabel} pageTitle="Compliance Review" pageSubtitle="Comprehensive compliance review against regulatory, funding, and safeguarding requirements" userName="Patricia Stone" userRole="External Auditor">
      <div className="p-6 space-y-5">
        {/* Stats + Compliance Score */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Compliant', value: String(compliantCount), icon: 'ri-check-double-line', colour: 'emerald' },
            { label: 'Partially Compliant', value: String(partialCount), icon: 'ri-alert-line', colour: 'amber' },
            { label: 'Non-Compliant', value: String(nonCompliantCount), icon: 'ri-close-circle-line', colour: 'red' },
            { label: 'Total Checks', value: String(COMPLIANCE_ITEMS.length), icon: 'ri-file-list-3-line', colour: 'primary' },
            { label: 'Overall Rating', value: `${Math.round((compliantCount / COMPLIANCE_ITEMS.length) * 100)}%`, icon: 'ri-shield-check-line', colour: 'accent' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.colour === 'primary' ? 'bg-primary-100 text-primary-600' : s.colour === 'accent' ? 'bg-accent-100 text-accent-700' : s.colour === 'red' ? 'bg-red-100 text-red-600' : s.colour === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Overall progress bar */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-foreground-700">Overall Compliance Score</span>
            <span className="text-[12px] font-semibold text-emerald-700">{Math.round((compliantCount / COMPLIANCE_ITEMS.length) * 100)}%</span>
          </div>
          <div className="h-2.5 bg-background-200 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.round((compliantCount / COMPLIANCE_ITEMS.length) * 100)}%` }}></div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requirement, category, ID..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Statuses</option>
              <option>Compliant</option>
              <option>Partial</option>
              <option>Non-Compliant</option>
              <option>Not Applicable</option>
            </select>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Categories</option>
              <option>DAS</option>
              <option>ILR</option>
              <option>Evidence</option>
              <option>Safeguarding</option>
              <option>GDPR</option>
              <option>Funding</option>
              <option>Signatures</option>
              <option>Ofsted</option>
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-download-line mr-1"></i> Export Report
            </button>
          </div>
        </div>

        {/* Compliance Checklist */}
        <div className="space-y-2">
          {filtered.map(item => {
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${statusColour(item.status)}`}>
                      <i className={`${item.status === 'Compliant' ? 'ri-check-line' : item.status === 'Partial' ? 'ri-alert-line' : item.status === 'Non-Compliant' ? 'ri-close-line' : 'ri-indeterminate-circle-line'} text-sm`}></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${categoryColour(item.category)}`}>{item.category}</span>
                        <p className="text-sm font-semibold text-foreground-900">{item.requirement}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColour(item.status)}`}>{item.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>Checked: {item.lastChecked}</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : item.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 transition-colors cursor-pointer">
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-[12px]">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-1 font-medium">Evidence Reference</p>
                        <p className="text-foreground-700 font-mono">{item.evidenceRef}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-1 font-medium">Checked By</p>
                        <p className="text-foreground-700">{item.checkedBy} on {item.lastChecked}</p>
                      </div>
                      <div className="lg:col-span-2">
                        <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-1 font-medium">Auditor Notes</p>
                        <p className="text-foreground-700 bg-background-50 rounded-lg p-3 border border-background-200/30">{item.notes}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-background-200/30">
                      <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-colors cursor-pointer whitespace-nowrap">
                        <i className="ri-check-line mr-1"></i> Mark Compliant
                      </button>
                      <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-semibold hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap">
                        <i className="ri-alert-line mr-1"></i> Flag Partial
                      </button>
                      <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap">
                        <i className="ri-close-line mr-1"></i> Mark Non-Compliant
                      </button>
                      <button className="px-3 py-1.5 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap ml-auto">
                        <i className="ri-edit-line mr-1"></i> Add Note
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i className="ri-shield-check-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No compliance items found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}