import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface EmployerContractQA {
  id: string;
  employer: string;
  programme: string;
  standard: string;
  learners: number;
  contractStatus: string;
  qaStatus: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  submittedDate: string;
  qaOfficer: string;
  checks: { label: string; passed: boolean }[];
}

const CONTRACT_QA_DATA: EmployerContractQA[] = [
  { id: 'ec-01', employer: 'Kent County Council', programme: 'Business Admin L3', standard: 'ST0070', learners: 4, contractStatus: 'Signed', qaStatus: 'Pending', risk: 'low', submittedDate: '8 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-02', employer: 'Balfour Beatty', programme: 'Business Admin L3', standard: 'ST0070', learners: 12, contractStatus: 'Awaiting Signature', qaStatus: 'Flagged', risk: 'high', submittedDate: '7 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'Signed Contract', passed: false }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: false }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-03', employer: 'Tesco PLC', programme: 'Digital Marketing L3', standard: 'ST0094', learners: 3, contractStatus: 'Signed', qaStatus: 'Pending', risk: 'low', submittedDate: '6 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-04', employer: 'NHS Digital', programme: 'Data Technician L3', standard: 'ST0118', learners: 5, contractStatus: 'Under Review', qaStatus: 'Pending', risk: 'medium', submittedDate: '5 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: false }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-05', employer: 'Costain Group', programme: 'Project Management L4', standard: 'ST0723', learners: 7, contractStatus: 'Signed', qaStatus: 'Approved', risk: 'low', submittedDate: '4 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-06', employer: 'Bright Horizons', programme: 'Early Years L3', standard: 'ST0135', learners: 6, contractStatus: 'Signed', qaStatus: 'Pending', risk: 'low', submittedDate: '3 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'DBS Check', passed: true }] },
  { id: 'ec-07', employer: 'Capgemini', programme: 'Software Dev L4', standard: 'ST0116', learners: 8, contractStatus: 'Signed', qaStatus: 'Reviewed', risk: 'low', submittedDate: '2 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-08', employer: 'Unilever', programme: 'HR Consultant L5', standard: 'ST0234', learners: 2, contractStatus: 'Awaiting Signature', qaStatus: 'Pending', risk: 'medium', submittedDate: '1 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'Signed Contract', passed: false }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-09', employer: 'Sainsbury\'s', programme: 'Digital Marketing L3', standard: 'ST0094', learners: 5, contractStatus: 'Signed', qaStatus: 'Approved', risk: 'low', submittedDate: '31 May', qaOfficer: 'Emma Clarke', checks: [{ label: 'Signed Contract', passed: true }, { label: 'Commitment Statement', passed: true }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
  { id: 'ec-10', employer: 'BT Group', programme: 'Data Technician L3', standard: 'ST0118', learners: 9, contractStatus: 'Under Review', qaStatus: 'Flagged', risk: 'high', submittedDate: '30 May', qaOfficer: 'James Whitfield', checks: [{ label: 'Signed Contract', passed: false }, { label: 'Commitment Statement', passed: false }, { label: 'Health & Safety', passed: true }, { label: 'Wage Compliance', passed: true }] },
];

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  Pending: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  Reviewed: { bg: 'bg-primary-100', text: 'text-primary-700', dot: 'bg-primary-500' },
  Approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  Flagged: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
};

const riskConfig: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

export default function QAEmployerContractingPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = CONTRACT_QA_DATA.filter(p => {
    const statusMatch = filterStatus === 'All' || p.qaStatus === filterStatus;
    const riskMatch = filterRisk === 'All' || p.risk === filterRisk;
    return statusMatch && riskMatch;
  });

  const stats = {
    pending: CONTRACT_QA_DATA.filter(p => p.qaStatus === 'Pending').length,
    approved: CONTRACT_QA_DATA.filter(p => p.qaStatus === 'Approved').length,
    flagged: CONTRACT_QA_DATA.filter(p => p.qaStatus === 'Flagged').length,
    reviewed: CONTRACT_QA_DATA.filter(p => p.qaStatus === 'Reviewed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Employer Contracting QA" pageSubtitle="Quality assure employer contracts, commitment statements and compliance documentation"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Employer Contracting QA"
          description={`${stats.pending} contracts pending QA. ${stats.flagged} flagged for review. ${stats.approved} approved and compliant.`}
          icon="ri-file-text-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20employer%20contract%20quality%20assurance%20review%20legal%20documents%20apprenticeship%20warm%20amber%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-employer-contract-hero&orientation=landscape"
          imageAlt="Employer Contracting QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Flagged', value: String(stats.flagged), variant: 'danger' },
            { label: 'Approved', value: String(stats.approved) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: stats.pending, icon: 'ri-time-line', color: 'amber' },
            { label: 'Reviewed', value: stats.reviewed, icon: 'ri-eye-line', color: 'primary' },
            { label: 'Approved', value: stats.approved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Flagged', value: stats.flagged, icon: 'ri-alert-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Pending', 'Reviewed', 'Approved', 'Flagged'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Risk:</span>
          {['All', 'low', 'medium', 'high'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterRisk === r ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="divide-y divide-background-200/30">
            {filtered.map(record => {
              const isExpanded = expandedId === record.id;
              return (
                <div key={record.id} className={`p-4 ${isExpanded ? 'bg-background-100/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>
                        <AppIcon className="ri-file-text-line text-sm"></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground-900">{record.employer}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>{record.qaStatus}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[record.risk].bg} ${riskConfig[record.risk].text}`}>{record.risk === 'low' ? 'Low Risk' : record.risk === 'medium' ? 'Medium Risk' : 'High Risk'}</span>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-foreground-400">{record.programme}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-medium text-foreground-500">{record.standard}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[11px] text-foreground-400">{record.learners} learners</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${record.contractStatus === 'Signed' ? 'bg-emerald-50 text-emerald-600' : record.contractStatus === 'Under Review' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>{record.contractStatus}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-foreground-400">{record.submittedDate}</span>
                      <span className="text-[10px] text-foreground-400">{record.qaOfficer}</span>
                      <button onClick={() => setExpandedId(isExpanded ? null : record.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer transition-smooth">
                        <AppIcon className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></AppIcon>
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-11 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {record.checks.map(check => (
                        <div key={check.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${check.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          <AppIcon className={check.passed ? 'ri-check-line' : 'ri-close-line'}></AppIcon>
                          <span>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}