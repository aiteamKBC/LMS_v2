import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface EligibilityQA {
  id: string;
  learner: string;
  programme: string;
  standard: string;
  employer: string;
  qaStatus: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  submittedDate: string;
  qaOfficer: string;
  checks: { label: string; passed: boolean }[];
}

const ELIGIBILITY_QA_DATA: EligibilityQA[] = [
  { id: 'el-01', learner: 'Olivia Hartley', programme: 'Business Admin L3', standard: 'ST0070', employer: 'Kent County Council', qaStatus: 'Pending', risk: 'low', submittedDate: '8 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'Prior Attainment Check', passed: false }] },
  { id: 'el-02', learner: 'Mohamed Farah', programme: 'Software Dev L4', standard: 'ST0116', employer: 'Capgemini', qaStatus: 'Approved', risk: 'low', submittedDate: '7 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'Prior Attainment Check', passed: true }] },
  { id: 'el-03', learner: 'Aisha Begum', programme: 'HR Consultant L5', standard: 'ST0234', employer: 'Unilever', qaStatus: 'Pending', risk: 'low', submittedDate: '6 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Degree Check', passed: true }, { label: 'Employer Size', passed: true }, { label: 'Co-investment', passed: true }] },
  { id: 'el-04', learner: 'Sophie Turner', programme: 'Early Years L3', standard: 'ST0135', employer: 'Bright Horizons', qaStatus: 'Pending', risk: 'low', submittedDate: '5 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'DBS Check', passed: true }] },
  { id: 'el-05', learner: 'Lucas Bennett', programme: 'Business Admin L3', standard: 'ST0070', employer: 'Balfour Beatty', qaStatus: 'Reviewed', risk: 'medium', submittedDate: '4 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: false }, { label: 'Prior Attainment Check', passed: true }] },
  { id: 'el-06', learner: 'Ryan Cooper', programme: 'Project Management L4', standard: 'ST0723', employer: 'Costain Group', qaStatus: 'Flagged', risk: 'high', submittedDate: '3 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency (3yr)', passed: false }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: false }, { label: 'Prior Attainment Check', passed: true }] },
  { id: 'el-07', learner: 'Daniel Price', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Tesco PLC', qaStatus: 'Pending', risk: 'low', submittedDate: '2 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'Prior Attainment Check', passed: true }] },
  { id: 'el-08', learner: 'Thomas Riley', programme: 'Data Technician L3', standard: 'ST0118', employer: 'BT Group', qaStatus: 'Approved', risk: 'low', submittedDate: '1 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'Prior Attainment Check', passed: true }] },
  { id: 'el-09', learner: 'Chloe Brown', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Sainsbury\'s', qaStatus: 'Pending', risk: 'medium', submittedDate: '31 May', qaOfficer: 'Emma Clarke', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'Prior Attainment Check', passed: false }] },
  { id: 'el-10', learner: 'Ella Morgan', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Sainsbury\'s', qaStatus: 'Pending', risk: 'low', submittedDate: '30 May', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency (3yr)', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Right to Work', passed: true }, { label: 'Prior Attainment Check', passed: true }] },
];

const statusConfig: Record<string, { bg: string; text: string }> = {
  Pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
  Reviewed: { bg: 'bg-primary-100', text: 'text-primary-700' },
  Approved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Flagged: { bg: 'bg-red-100', text: 'text-red-700' },
};

const riskConfig: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

export default function QAEligibilityPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = ELIGIBILITY_QA_DATA.filter(p => {
    const statusMatch = filterStatus === 'All' || p.qaStatus === filterStatus;
    const riskMatch = filterRisk === 'All' || p.risk === filterRisk;
    return statusMatch && riskMatch;
  });

  const stats = {
    pending: ELIGIBILITY_QA_DATA.filter(p => p.qaStatus === 'Pending').length,
    approved: ELIGIBILITY_QA_DATA.filter(p => p.qaStatus === 'Approved').length,
    flagged: ELIGIBILITY_QA_DATA.filter(p => p.qaStatus === 'Flagged').length,
    reviewed: ELIGIBILITY_QA_DATA.filter(p => p.qaStatus === 'Reviewed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Eligibility QA" pageSubtitle="Quality assure learner eligibility evidence for funding compliance"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Eligibility QA"
          description={`${stats.pending} cases pending QA. ${stats.flagged} flagged for review. ${stats.approved} approved and compliant.`}
          icon="ri-checkbox-circle-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20apprenticeship%20eligibility%20review%20checklist%20funding%20compliance%20quality%20assurance%20warm%20amber%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-eligibility-hero&orientation=landscape"
          imageAlt="Eligibility QA"
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
                <i className={`${s.icon} text-sm`}></i>
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
          <div className="p-4 border-b border-foreground-400/50">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Eligibility QA Pipeline</h3>
            <p className="text-[11px] text-foreground-400 mt-0.5">{filtered.length} cases matching filters</p>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(record => {
              const isExpanded = expandedId === record.id;
              return (
                <div key={record.id} className={`p-4 ${isExpanded ? 'bg-background-100/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>
                        <i className="ri-checkbox-circle-line text-sm"></i>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground-900">{record.learner}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>{record.qaStatus}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[record.risk].bg} ${riskConfig[record.risk].text}`}>{record.risk === 'low' ? 'Low' : record.risk === 'medium' ? 'Medium' : 'High'}</span>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-foreground-400">{record.programme}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-medium text-foreground-500">{record.standard}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[11px] text-foreground-400">{record.employer}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-foreground-400">{record.submittedDate}</span>
                      <span className="text-[10px] text-foreground-400">{record.qaOfficer}</span>
                      <button onClick={() => setExpandedId(isExpanded ? null : record.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer transition-smooth">
                        <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-11 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {record.checks.map(check => (
                        <div key={check.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${check.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          <i className={check.passed ? 'ri-check-line' : 'ri-close-line'}></i>
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