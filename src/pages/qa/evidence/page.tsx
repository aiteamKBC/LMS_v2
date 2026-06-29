import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface EvidenceQA {
  id: string;
  learner: string;
  title: string;
  type: string;
  module: string;
  submitted: string;
  coachStatus: string;
  qaStatus: 'Pending' | 'Sampled' | 'Validated' | 'Escalated' | 'Rejected';
  risk: 'low' | 'medium' | 'high';
  ksbCount: number;
  wordCount: number;
}

const EVIDENCE_QA_DATA: EvidenceQA[] = [
  { id: 'eq-01', learner: 'Sophie Williams', title: 'Customer Persona — Tim Hortons Campaign', type: 'Workplace Project', module: 'Marketing Planning', submitted: '8 Jun', coachStatus: 'Validated', qaStatus: 'Pending', risk: 'low', ksbCount: 3, wordCount: 1250 },
  { id: 'eq-02', learner: 'James Okonkwo', title: 'Data Cleaning Report', type: 'Report', module: 'Data Analysis', submitted: '7 Jun', coachStatus: 'Pending', qaStatus: 'Pending', risk: 'medium', ksbCount: 2, wordCount: 890 },
  { id: 'eq-03', learner: 'Aisha Patel', title: 'Month-end Reconciliation', type: 'Workplace Evidence', module: 'Financial Accounting', submitted: '6 Jun', coachStatus: 'Validated', qaStatus: 'Pending', risk: 'low', ksbCount: 4, wordCount: 2100 },
  { id: 'eq-04', learner: 'Emily Watson', title: 'Social Media Campaign Results', type: 'Campaign Evidence', module: 'Digital Channels', submitted: '5 Jun', coachStatus: 'Validated', qaStatus: 'Sampled', risk: 'low', ksbCount: 3, wordCount: 1560 },
  { id: 'eq-05', learner: 'Liam Foster', title: 'Project Risk Register', type: 'Project Evidence', module: 'Risk Management', submitted: '4 Jun', coachStatus: 'Rejected', qaStatus: 'Escalated', risk: 'high', ksbCount: 1, wordCount: 340 },
  { id: 'eq-06', learner: 'Sarah Mitchell', title: 'Meeting Minutes — Board Prep', type: 'Workplace Evidence', module: 'Business Admin', submitted: '3 Jun', coachStatus: 'Validated', qaStatus: 'Pending', risk: 'low', ksbCount: 2, wordCount: 780 },
  { id: 'eq-07', learner: 'David Chen', title: 'Code Review Documentation', type: 'Documentation', module: 'Software Development', submitted: '2 Jun', coachStatus: 'Pending', qaStatus: 'Pending', risk: 'medium', ksbCount: 2, wordCount: 1120 },
  { id: 'eq-08', learner: 'Maya Kapoor', title: 'Initial Assessment Reflection', type: 'Reflection', module: 'HR Induction', submitted: '1 Jun', coachStatus: 'Validated', qaStatus: 'Pending', risk: 'low', ksbCount: 1, wordCount: 450 },
  { id: 'eq-09', learner: 'Oliver Smith', title: 'Marketing Plan — Product Launch', type: 'Workplace Project', module: 'Marketing Planning', submitted: '31 May', coachStatus: 'Validated', qaStatus: 'Validated', risk: 'low', ksbCount: 5, wordCount: 3200 },
  { id: 'eq-10', learner: 'Chloe Brown', title: 'Website Analytics Report', type: 'Report', module: 'Digital Channels', submitted: '30 May', coachStatus: 'Validated', qaStatus: 'Sampled', risk: 'low', ksbCount: 3, wordCount: 1450 },
];

const qaStatusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  Pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-time-line' },
  Sampled: { bg: 'bg-accent-100', text: 'text-accent-700', icon: 'ri-pie-chart-2-line' },
  Validated: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-check-line' },
  Escalated: { bg: 'bg-red-100', text: 'text-red-700', icon: 'ri-alert-line' },
  Rejected: { bg: 'bg-red-100', text: 'text-red-700', icon: 'ri-close-line' },
};

const riskConfig: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

export default function QAEvidencePage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const filtered = EVIDENCE_QA_DATA.filter(e => {
    const statusMatch = filterStatus === 'All' || e.qaStatus === filterStatus;
    const riskMatch = filterRisk === 'All' || e.risk === filterRisk;
    return statusMatch && riskMatch;
  });

  const toggleSelect = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stats = {
    pending: EVIDENCE_QA_DATA.filter(e => e.qaStatus === 'Pending').length,
    sampled: EVIDENCE_QA_DATA.filter(e => e.qaStatus === 'Sampled').length,
    validated: EVIDENCE_QA_DATA.filter(e => e.qaStatus === 'Validated').length,
    escalated: EVIDENCE_QA_DATA.filter(e => e.qaStatus === 'Escalated').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Evidence QA" pageSubtitle="Quality assure learner evidence submissions with sampling methodology"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Evidence QA"
          description={`${stats.pending} items pending. ${stats.sampled} sampled. ${stats.validated} validated. ${stats.escalated} escalated.`}
          icon="ri-folder-upload-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20evidence%20review%20quality%20assurance%20documents%20folder%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-evidence-hero&orientation=landscape"
          imageAlt="Evidence QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Sampled', value: String(stats.sampled) },
            { label: 'Validated', value: String(stats.validated) },
          ]}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: stats.pending, icon: 'ri-time-line', color: 'amber' },
            { label: 'Sampled', value: stats.sampled, icon: 'ri-pie-chart-2-line', color: 'accent' },
            { label: 'Validated', value: stats.validated, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Escalated', value: stats.escalated, icon: 'ri-alert-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters + Bulk */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">QA Status:</span>
          {['All', 'Pending', 'Sampled', 'Validated', 'Escalated', 'Rejected'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Risk:</span>
          {['All', 'low', 'medium', 'high'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterRisk === r ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}</button>
          ))}
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px] text-foreground-400">{selectedItems.size} selected</span>
              <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-medium hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap">Bulk Validate</button>
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-medium hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Bulk Sample</button>
            </div>
          )}
        </div>

        {/* Evidence List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-3 border-b border-foreground-400/50 flex items-center gap-2">
            <input type="checkbox" className="w-4 h-4 rounded accent-primary-500" onChange={() => {
              if (selectedItems.size === filtered.length) setSelectedItems(new Set());
              else setSelectedItems(new Set(filtered.map(e => e.id)));
            }} checked={filtered.length > 0 && selectedItems.size === filtered.length} />
            <span className="text-[11px] font-medium text-foreground-500">Select all</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(item => {
              const selected = selectedItems.has(item.id);
              return (
                <div key={item.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${item.risk === 'high' ? 'bg-red-50/30' : item.risk === 'medium' ? 'bg-amber-50/20' : ''} ${selected ? 'bg-primary-50/50' : ''}`}>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={selected} onChange={() => toggleSelect(item.id)} className="w-4 h-4 rounded accent-primary-500 shrink-0" />
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${qaStatusConfig[item.qaStatus].bg} ${qaStatusConfig[item.qaStatus].text}`}>
                      <i className={`${qaStatusConfig[item.qaStatus].icon} text-sm`}></i>
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-foreground-900">{item.title}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[item.risk].bg} ${riskConfig[item.risk].text}`}>{item.risk === 'low' ? 'Low' : item.risk === 'medium' ? 'Medium' : 'High'}</span>
                    </div>
                    <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap text-[11px] text-foreground-400">
                      <span>{item.learner}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{item.type}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{item.module}</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{item.wordCount.toLocaleString()} words</span>
                      <span className="text-[8px] text-foreground-300">&middot;</span>
                      <span>{item.ksbCount} KSBs</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.coachStatus === 'Validated' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>Coach: {item.coachStatus}</span>
                    <span className="text-[10px] text-foreground-400">{item.submitted}</span>
                    {item.qaStatus === 'Pending' && (
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review</button>
                    )}
                    {item.qaStatus === 'Escalated' && (
                      <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">Investigate</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}