import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface PreActiveRecord {
  id: string;
  learner: string;
  programme: string;
  standard: string;
  employer: string;
  stage: string;
  status: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  submittedDate: string;
  qaOfficer: string;
  checks: { label: string; passed: boolean }[];
}

const PRE_ACTIVE_DATA: PreActiveRecord[] = [
  { id: 'pa-01', learner: 'Olivia Hartley', programme: 'Business Admin L3', standard: 'ST0070', employer: 'Kent County Council', stage: 'Eligibility', status: 'Pending', risk: 'low', submittedDate: '8 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'UK Residency', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Prior Attainment', passed: false }, { label: 'Employer Contract', passed: true }] },
  { id: 'pa-02', learner: 'Daniel Price', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Tesco PLC', stage: 'Initial Assessment', status: 'Flagged', risk: 'high', submittedDate: '7 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'BKSB Results', passed: false }, { label: 'Learning Style', passed: true }, { label: 'Readiness Score', passed: false }, { label: 'Maths Level', passed: false }] },
  { id: 'pa-03', learner: 'Zara Ahmed', programme: 'Data Technician L3', standard: 'ST0118', employer: 'NHS Digital', stage: 'Enrolment Review', status: 'Pending', risk: 'medium', submittedDate: '6 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'ILR Match', passed: true }, { label: 'DAS Record', passed: true }, { label: 'Funding Band', passed: true }, { label: 'Programme Match', passed: false }] },
  { id: 'pa-04', learner: 'Lucas Bennett', programme: 'Business Admin L3', standard: 'ST0070', employer: 'Balfour Beatty', stage: 'RPL Review', status: 'Reviewed', risk: 'low', submittedDate: '5 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc', passed: true }, { label: 'KSB Mapping', passed: true }] },
  { id: 'pa-05', learner: 'Sophie Turner', programme: 'Early Years L3', standard: 'ST0135', employer: 'Bright Horizons', stage: 'Eligibility', status: 'Pending', risk: 'low', submittedDate: '4 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency', passed: true }, { label: 'Age Verification', passed: true }, { label: 'Prior Attainment', passed: true }, { label: 'DBS Check', passed: true }] },
  { id: 'pa-06', learner: 'Mohamed Farah', programme: 'Software Dev L4', standard: 'ST0116', employer: 'Capgemini', stage: 'Self-Onboarding', status: 'Approved', risk: 'low', submittedDate: '3 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'Policies Read', passed: true }, { label: 'Evidence Submitted', passed: true }, { label: 'Induction Complete', passed: true }, { label: 'Goals Set', passed: true }] },
  { id: 'pa-07', learner: 'Ella Morgan', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Sainsbury\'s', stage: 'Initial Assessment', status: 'Pending', risk: 'medium', submittedDate: '2 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'BKSB Results', passed: true }, { label: 'Learning Style', passed: false }, { label: 'Readiness Score', passed: true }, { label: 'English Level', passed: true }] },
  { id: 'pa-08', learner: 'Ryan Cooper', programme: 'Project Management L4', standard: 'ST0723', employer: 'Costain Group', stage: 'Employer Contracting', status: 'Flagged', risk: 'high', submittedDate: '1 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'Contract Signed', passed: false }, { label: 'Health & Safety', passed: false }, { label: 'Commitment Stmt', passed: true }, { label: 'Wage Check', passed: true }] },
  { id: 'pa-09', learner: 'Aisha Begum', programme: 'HR Consultant L5', standard: 'ST0234', employer: 'Unilever', stage: 'Eligibility', status: 'Pending', risk: 'low', submittedDate: '31 May', qaOfficer: 'James Whitfield', checks: [{ label: 'UK Residency', passed: true }, { label: 'Degree Check', passed: true }, { label: 'Employer Size', passed: true }, { label: 'Co-investment', passed: true }] },
  { id: 'pa-10', learner: 'Thomas Riley', programme: 'Data Technician L3', standard: 'ST0118', employer: 'BT Group', stage: 'Enrolment Review', status: 'Reviewed', risk: 'low', submittedDate: '30 May', qaOfficer: 'Emma Clarke', checks: [{ label: 'ILR Match', passed: true }, { label: 'DAS Record', passed: true }, { label: 'OE Start Date', passed: true }, { label: 'Officer Approval', passed: true }] },
];

const stageOrder = ['Eligibility', 'Initial Assessment', 'RPL Review', 'Employer Contracting', 'Self-Onboarding', 'Enrolment Review'];

export default function QAPreActivePage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = PRE_ACTIVE_DATA.filter(p => {
    const statusMatch = filterStatus === 'All' || p.status === filterStatus;
    const riskMatch = filterRisk === 'All' || p.risk === filterRisk;
    return statusMatch && riskMatch;
  });

  const stats = {
    pending: PRE_ACTIVE_DATA.filter(p => p.status === 'Pending').length,
    approved: PRE_ACTIVE_DATA.filter(p => p.status === 'Approved').length,
    flagged: PRE_ACTIVE_DATA.filter(p => p.status === 'Flagged').length,
    reviewed: PRE_ACTIVE_DATA.filter(p => p.status === 'Reviewed').length,
  };

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

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Onboarding QA" pageSubtitle="Quality assure onboarding learner records before programme activation"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Onboarding QA"
          description={`${stats.pending} records pending QA. ${stats.flagged} flagged for review. ${stats.approved} approved and ready for activation.`}
          icon="ri-user-received-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20UK%20apprenticeship%20onboarding%20quality%20assurance%20review%20desk%20with%20documents%20checklist%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-preactive-hero&orientation=landscape"
          imageAlt="Onboarding QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Flagged', value: String(stats.flagged), variant: 'danger' },
            { label: 'Approved', value: String(stats.approved) },
          ]}
        />

        {/* Stats */}
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

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Pending', 'Reviewed', 'Approved', 'Flagged'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Risk:</span>
          {['All', 'low', 'medium', 'high'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterRisk === r ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : r === 'high' ? 'High' : 'All'}</button>
          ))}
        </div>

        {/* Pipeline */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Onboarding Pipeline</h3>
              <p className="text-[11px] text-foreground-400 mt-0.5">{filtered.length} records matching filters</p>
            </div>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(record => {
              const isExpanded = expandedId === record.id;
              const stageIndex = stageOrder.indexOf(record.stage);
              return (
                <div key={record.id} className={`p-4 ${isExpanded ? 'bg-background-100/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[record.status].bg} ${statusConfig[record.status].text}`}>
                        <AppIcon className="ri-user-received-line text-sm"></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground-900">{record.learner}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[record.status].bg} ${statusConfig[record.status].text}`}>{record.status}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[record.risk].bg} ${riskConfig[record.risk].text}`}>{record.risk === 'low' ? 'Low Risk' : record.risk === 'medium' ? 'Medium Risk' : 'High Risk'}</span>
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
                      {/* Stage progress */}
                      <div className="flex items-center gap-1">
                        {stageOrder.map((stage, i) => (
                          <span key={stage} className={`w-2 h-2 rounded-full ${i <= stageIndex ? 'bg-primary-500' : 'bg-background-200'}`} title={stage}></span>
                        ))}
                      </div>
                      <span className="text-[10px] text-foreground-400">{record.stage}</span>
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