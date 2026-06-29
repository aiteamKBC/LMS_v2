import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface RPLQA {
  id: string;
  learner: string;
  programme: string;
  standard: string;
  employer: string;
  rplClaim: string;
  durationReduction: string;
  qaStatus: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  submittedDate: string;
  qaOfficer: string;
  checks: { label: string; passed: boolean }[];
}

const RPL_QA_DATA: RPLQA[] = [
  { id: 'rp-01', learner: 'Lucas Bennett', programme: 'Business Admin L3', standard: 'ST0070', employer: 'Balfour Beatty', rplClaim: 'Prior admin experience (2yr)', durationReduction: '6 months', qaStatus: 'Reviewed', risk: 'low', submittedDate: '8 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: true }] },
  { id: 'rp-02', learner: 'Aisha Patel', programme: 'HR Consultant L5', standard: 'ST0234', employer: 'Unilever', rplClaim: 'CIPD Level 3 Certificate', durationReduction: '9 months', qaStatus: 'Pending', risk: 'low', submittedDate: '7 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: false }] },
  { id: 'rp-03', learner: 'Sarah Mitchell', programme: 'Business Admin L3', standard: 'ST0070', employer: 'Kent County Council', rplClaim: 'NVQ Level 2 Business Admin', durationReduction: '12 months', qaStatus: 'Pending', risk: 'medium', submittedDate: '6 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: false }, { label: 'KSB Mapping', passed: true }] },
  { id: 'rp-04', learner: 'David Chen', programme: 'Software Dev L4', standard: 'ST0116', employer: 'Capgemini', rplClaim: 'Codecademy Pro Certificate', durationReduction: '3 months', qaStatus: 'Approved', risk: 'low', submittedDate: '5 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: true }] },
  { id: 'rp-05', learner: 'Emily Watson', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Tesco PLC', rplClaim: 'Google Digital Garage', durationReduction: '4 months', qaStatus: 'Pending', risk: 'low', submittedDate: '4 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: false }] },
  { id: 'rp-06', learner: 'Chloe Brown', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Sainsbury\'s', rplClaim: 'HubSpot Content Marketing', durationReduction: '3 months', qaStatus: 'Flagged', risk: 'high', submittedDate: '3 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'RPL Claim Valid', passed: false }, { label: 'Evidence Attached', passed: false }, { label: 'Duration Calc Correct', passed: false }, { label: 'KSB Mapping', passed: false }] },
  { id: 'rp-07', learner: 'Maya Kapoor', programme: 'HR Consultant L5', standard: 'ST0234', employer: 'Unilever', rplClaim: 'HR Admin experience (1yr)', durationReduction: '6 months', qaStatus: 'Pending', risk: 'medium', submittedDate: '2 Jun', qaOfficer: 'Emma Clarke', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: false }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: true }] },
  { id: 'rp-08', learner: 'Oliver Smith', programme: 'Digital Marketing L3', standard: 'ST0094', employer: 'Tesco PLC', rplClaim: 'Meta Social Media Cert', durationReduction: '4 months', qaStatus: 'Approved', risk: 'low', submittedDate: '1 Jun', qaOfficer: 'James Whitfield', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: true }] },
  { id: 'rp-09', learner: 'James Okonkwo', programme: 'Data Technician L3', standard: 'ST0118', employer: 'NHS Digital', rplClaim: 'Excel MOS Certification', durationReduction: '2 months', qaStatus: 'Pending', risk: 'low', submittedDate: '31 May', qaOfficer: 'Emma Clarke', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: true }] },
  { id: 'rp-10', learner: 'Liam Foster', programme: 'Project Management L4', standard: 'ST0723', employer: 'Costain Group', rplClaim: 'APM PFQ Certificate', durationReduction: '6 months', qaStatus: 'Pending', risk: 'low', submittedDate: '30 May', qaOfficer: 'James Whitfield', checks: [{ label: 'RPL Claim Valid', passed: true }, { label: 'Evidence Attached', passed: true }, { label: 'Duration Calc Correct', passed: true }, { label: 'KSB Mapping', passed: false }] },
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

export default function QARPLPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = RPL_QA_DATA.filter(p => {
    const statusMatch = filterStatus === 'All' || p.qaStatus === filterStatus;
    const riskMatch = filterRisk === 'All' || p.risk === filterRisk;
    return statusMatch && riskMatch;
  });

  const stats = {
    pending: RPL_QA_DATA.filter(p => p.qaStatus === 'Pending').length,
    approved: RPL_QA_DATA.filter(p => p.qaStatus === 'Approved').length,
    flagged: RPL_QA_DATA.filter(p => p.qaStatus === 'Flagged').length,
    reviewed: RPL_QA_DATA.filter(p => p.qaStatus === 'Reviewed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="RPL QA" pageSubtitle="Quality assure Recognition of Prior Learning claims and duration reductions"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="RPL QA"
          description={`${stats.pending} RPL claims pending QA. ${stats.flagged} flagged for review. ${stats.approved} approved.`}
          icon="ri-file-search-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20RPL%20recognition%20prior%20learning%20quality%20assurance%20review%20evidence%20documents%20warm%20amber%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-rpl-hero&orientation=landscape"
          imageAlt="RPL QA"
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
            <h3 className="text-sm font-heading font-semibold text-foreground-900">RPL Pipeline</h3>
            <p className="text-[11px] text-foreground-400 mt-0.5">{filtered.length} RPL claims matching filters</p>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(record => {
              const isExpanded = expandedId === record.id;
              return (
                <div key={record.id} className={`p-4 ${isExpanded ? 'bg-background-100/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>
                        <i className="ri-file-search-line text-sm"></i>
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
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">{record.rplClaim}</span>
                          <span className="text-[10px] font-semibold text-foreground-600">−{record.durationReduction}</span>
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