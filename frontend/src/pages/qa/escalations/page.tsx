import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface Escalation {
  id: string;
  title: string;
  category: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Open' | 'Under Investigation' | 'Resolved' | 'Escalated Further';
  raisedBy: string;
  assignedTo: string;
  date: string;
  description: string;
  actions: string[];
}

const ESCALATION_DATA: Escalation[] = [
  { id: 'esc-01', title: 'Learner OTJH Fraud Suspected', category: 'OTJH', severity: 'Critical', status: 'Under Investigation', raisedBy: 'QA Officer', assignedTo: 'QA Lead', date: '5 Jun', description: 'James Okonkwo submitted 4.5h OTJH for self-study on 3 Jun. No Teams attendance, no employer sign-off. Pattern of inflated hours over 3 weeks.', actions: ['Review 3-week history', 'Interview learner', 'Contact employer', 'Request evidence'] },
  { id: 'esc-02', title: 'Coach Validation Bias Pattern', category: 'Evidence', severity: 'High', status: 'Open', raisedBy: 'QA Lead', assignedTo: 'Senior Leadership', date: '4 Jun', description: 'Coach Sarah Chen has 95% validation rate vs 72% org average. 8 rejected items from her caseload were all overturned on appeal. Potential bias detected.', actions: ['Audit all validations by coach', 'Compare peer benchmarks', 'Review appeal outcomes', 'Schedule meeting'] },
  { id: 'esc-03', title: 'KSB Assessment Inconsistency', category: 'KSB', severity: 'Medium', status: 'Under Investigation', raisedBy: 'QA Officer', assignedTo: 'QA Lead', date: '3 Jun', description: 'Three different assessors applied different standards for KSB S12 validation. Two approved with 1 evidence item, one required 3. Standardisation needed.', actions: ['Review assessment criteria', 'Hold standardisation meeting', 'Update guidance', 'Re-affected items'] },
  { id: 'esc-04', title: 'Employer Contracting Delay', category: 'Compliance', severity: 'Medium', status: 'Open', raisedBy: 'QA Officer', assignedTo: 'Engagement Team', date: '2 Jun', description: 'Balfour Beatty employer contract still unsigned after 6 weeks. 12 learners affected. Risk of funding clawback if not resolved by 15 Jun.', actions: ['Escalate to employer', 'Engagement team call', 'Legal review', 'Contingency plan'] },
  { id: 'esc-05', title: 'Data Quality in ILR Export', category: 'Data', severity: 'Low', status: 'Resolved', raisedBy: 'QA Officer', assignedTo: 'MIS Team', date: '1 Jun', description: 'ILR export had 7 learners with incorrect programme start dates. Affected funding claims for May 2026. Fixed and re-exported.', actions: ['Correct data', 'Re-export ILR', 'Verify funding impact', 'Close'] },
  { id: 'esc-06', title: 'Sampling Coverage Gap', category: 'Sampling', severity: 'High', status: 'Escalated Further', raisedBy: 'QA Lead', assignedTo: 'Senior Leadership', date: '31 May', description: 'Q2 sampling only covered 8% of evidence items vs 15% target. High-risk learners underrepresented. Ofsted concern raised.', actions: ['Increase sampling', 'Prioritise high-risk', 'Report to leadership', 'Q3 plan'] },
];

const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  Critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  High: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  Medium: { bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-300' },
  Low: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
};

const statusConfig: Record<string, { bg: string; text: string }> = {
  Open: { bg: 'bg-red-100', text: 'text-red-700' },
  'Under Investigation': { bg: 'bg-amber-100', text: 'text-amber-700' },
  Resolved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Escalated Further': { bg: 'bg-primary-100', text: 'text-primary-700' },
};

export default function QAEscalationsPage() {
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = ESCALATION_DATA.filter(e => {
    const sevMatch = filterSeverity === 'All' || e.severity === filterSeverity;
    const statusMatch = filterStatus === 'All' || e.status === filterStatus;
    return sevMatch && statusMatch;
  });

  const stats = {
    open: ESCALATION_DATA.filter(e => e.status === 'Open').length,
    investigating: ESCALATION_DATA.filter(e => e.status === 'Under Investigation').length,
    resolved: ESCALATION_DATA.filter(e => e.status === 'Resolved').length,
    escalated: ESCALATION_DATA.filter(e => e.status === 'Escalated Further').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Escalations" pageSubtitle="Manage escalated quality issues requiring senior intervention"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Escalations"
          description={`${stats.open} open. ${stats.investigating} under investigation. ${stats.resolved} resolved. ${stats.escalated} escalated further.`}
          icon="ri-alert-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20escalation%20management%20alert%20warning%20quality%20issue%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-escalations-hero&orientation=landscape"
          imageAlt="Escalations"
          stats={[
            { label: 'Open', value: String(stats.open), variant: 'danger' },
            { label: 'Investigating', value: String(stats.investigating) },
            { label: 'Resolved', value: String(stats.resolved) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open', value: stats.open, icon: 'ri-alert-line', color: 'red' },
            { label: 'Investigating', value: stats.investigating, icon: 'ri-search-line', color: 'amber' },
            { label: 'Resolved', value: stats.resolved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Escalated', value: stats.escalated, icon: 'ri-arrow-up-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'red' ? 'bg-red-100 text-red-700' : s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Severity:</span>
          {['All', 'Critical', 'High', 'Medium', 'Low'].map(s => (
            <button key={s} onClick={() => setFilterSeverity(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterSeverity === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Status:</span>
          {['All', 'Open', 'Under Investigation', 'Resolved', 'Escalated Further'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map(esc => (
            <div key={esc.id} className={`bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium border-l-2 ${severityConfig[esc.severity].border}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${severityConfig[esc.severity].bg} ${severityConfig[esc.severity].text}`}>{esc.severity}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[esc.status].bg} ${statusConfig[esc.status].text}`}>{esc.status}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{esc.category}</span>
                </div>
                <span className="text-[10px] text-foreground-400">{esc.date}</span>
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-1">{esc.title}</h4>
              <p className="text-[11px] text-foreground-400 mb-1">Raised by: {esc.raisedBy} &middot; Assigned: {esc.assignedTo}</p>
              <p className="text-[12px] text-foreground-600 leading-relaxed mb-3">{esc.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {esc.actions.map((action, i) => (
                  <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{action}</span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {esc.status === 'Open' && (
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Investigate</button>
                )}
                {esc.status === 'Under Investigation' && (
                  <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap">Resolve</button>
                )}
                {esc.status === 'Escalated Further' && (
                  <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">Update Leadership</button>
                )}
                <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">View Details</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}