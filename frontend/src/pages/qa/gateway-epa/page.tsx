import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface GatewayEPAQA {
  id: string;
  learner: string;
  programme: string;
  standard: string;
  stage: string;
  epaOrganisation: string;
  gatewayDate: string;
  qaStatus: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  qaOfficer: string;
  checks: { label: string; passed: boolean }[];
}

const GATEWAY_EPA_DATA: GatewayEPAQA[] = [
  { id: 'ge-01', learner: 'Emily Watson', programme: 'Digital Marketing L3', standard: 'ST0094', stage: 'Gateway Ready', epaOrganisation: 'NCFE', gatewayDate: '15 Jul', qaStatus: 'Pending', risk: 'low', qaOfficer: 'Emma Clarke', checks: [{ label: 'KSB Evidence Complete', passed: true }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: true }, { label: 'Portfolio Reviewed', passed: false }] },
  { id: 'ge-02', learner: 'Sarah Mitchell', programme: 'Business Admin L3', standard: 'ST0070', stage: 'EPA Preparation', epaOrganisation: 'City & Guilds', gatewayDate: '1 Aug', qaStatus: 'Pending', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'KSB Evidence Complete', passed: true }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: true }, { label: 'Portfolio Reviewed', passed: true }] },
  { id: 'ge-03', learner: 'Oliver Smith', programme: 'Digital Marketing L3', standard: 'ST0094', stage: 'Gateway Review', epaOrganisation: 'NCFE', gatewayDate: '22 Jun', qaStatus: 'Flagged', risk: 'high', qaOfficer: 'Emma Clarke', checks: [{ label: 'KSB Evidence Complete', passed: false }, { label: 'OTJH Threshold Met', passed: false }, { label: 'Employer Sign-off', passed: true }, { label: 'Portfolio Reviewed', passed: false }] },
  { id: 'ge-04', learner: 'David Chen', programme: 'Software Dev L4', standard: 'ST0116', stage: 'Gateway Ready', epaOrganisation: 'BCS', gatewayDate: '5 Aug', qaStatus: 'Reviewed', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'KSB Evidence Complete', passed: true }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: true }, { label: 'Portfolio Reviewed', passed: true }] },
  { id: 'ge-05', learner: 'Aisha Patel', programme: 'HR Consultant L5', standard: 'ST0234', stage: 'EPA Preparation', epaOrganisation: 'CIPD', gatewayDate: '1 Sep', qaStatus: 'Pending', risk: 'medium', qaOfficer: 'Emma Clarke', checks: [{ label: 'KSB Evidence Complete', passed: true }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: false }, { label: 'Portfolio Reviewed', passed: true }] },
  { id: 'ge-06', learner: 'Sophie Williams', programme: 'Business Admin L3', standard: 'ST0070', stage: 'Gateway Review', epaOrganisation: 'City & Guilds', gatewayDate: '28 Jun', qaStatus: 'Approved', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'KSB Evidence Complete', passed: true }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: true }, { label: 'Portfolio Reviewed', passed: true }] },
  { id: 'ge-07', learner: 'Liam Foster', programme: 'Project Management L4', standard: 'ST0723', stage: 'EPA Preparation', epaOrganisation: 'APM', gatewayDate: '12 Aug', qaStatus: 'Pending', risk: 'high', qaOfficer: 'Emma Clarke', checks: [{ label: 'KSB Evidence Complete', passed: false }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: false }, { label: 'Portfolio Reviewed', passed: false }] },
  { id: 'ge-08', learner: 'Chloe Brown', programme: 'Digital Marketing L3', standard: 'ST0094', stage: 'Gateway Ready', epaOrganisation: 'NCFE', gatewayDate: '20 Jul', qaStatus: 'Pending', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'KSB Evidence Complete', passed: true }, { label: 'OTJH Threshold Met', passed: true }, { label: 'Employer Sign-off', passed: true }, { label: 'Portfolio Reviewed', passed: true }] },
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

const stageConfig: Record<string, { bg: string; text: string }> = {
  'Gateway Ready': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Gateway Review': { bg: 'bg-primary-100', text: 'text-primary-700' },
  'EPA Preparation': { bg: 'bg-amber-100', text: 'text-amber-700' },
};

export default function QAGatewayEPAPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [filterStage, setFilterStage] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = GATEWAY_EPA_DATA.filter(p => {
    const statusMatch = filterStatus === 'All' || p.qaStatus === filterStatus;
    const riskMatch = filterRisk === 'All' || p.risk === filterRisk;
    const stageMatch = filterStage === 'All' || p.stage === filterStage;
    return statusMatch && riskMatch && stageMatch;
  });

  const stats = {
    pending: GATEWAY_EPA_DATA.filter(p => p.qaStatus === 'Pending').length,
    approved: GATEWAY_EPA_DATA.filter(p => p.qaStatus === 'Approved').length,
    flagged: GATEWAY_EPA_DATA.filter(p => p.qaStatus === 'Flagged').length,
    reviewed: GATEWAY_EPA_DATA.filter(p => p.qaStatus === 'Reviewed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Gateway & EPA QA" pageSubtitle="Quality assure gateway readiness and End-Point Assessment preparations"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Gateway & EPA QA"
          description={`${stats.pending} learners pending QA. ${stats.flagged} flagged. ${stats.approved} approved for gateway.`}
          icon="ri-flag-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20apprenticeship%20gateway%20EPA%20end%20point%20assessment%20readiness%20review%20checklist%20warm%20amber%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-gateway-epa-hero&orientation=landscape"
          imageAlt="Gateway & EPA QA"
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
            <div key={s.label} className="coach-metric-card">
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
          <span className="text-[12px] text-foreground-400 ml-2">Stage:</span>
          {['All', 'Gateway Ready', 'Gateway Review', 'EPA Preparation'].map(s => (
            <button key={s} onClick={() => setFilterStage(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStage === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Risk:</span>
          {['All', 'low', 'medium', 'high'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterRisk === r ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Gateway & EPA Pipeline</h3>
            <p className="text-[11px] text-foreground-400 mt-0.5">{filtered.length} learners matching filters</p>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(record => {
              const isExpanded = expandedId === record.id;
              return (
                <div key={record.id} className={`p-4 ${isExpanded ? 'bg-background-100/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>
                        <AppIcon className="ri-flag-line text-sm"></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground-900">{record.learner}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>{record.qaStatus}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${stageConfig[record.stage]?.bg || 'bg-foreground-100'} ${stageConfig[record.stage]?.text || 'text-foreground-500'}`}>{record.stage}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[record.risk].bg} ${riskConfig[record.risk].text}`}>{record.risk === 'low' ? 'Low' : record.risk === 'medium' ? 'Medium' : 'High'}</span>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-foreground-400">{record.programme}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-medium text-foreground-500">{record.standard}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">EPA: {record.epaOrganisation}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-semibold text-foreground-600">Gateway {record.gatewayDate}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
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
