import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface QAFinding {
  id: string;
  title: string;
  category: string;
  severity: 'Critical' | 'Major' | 'Minor' | 'Observation';
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  raisedBy: string;
  date: string;
  description: string;
  actionPlan: string;
  owner: string;
  dueDate: string;
  daysRemaining: number;
}

const FINDINGS_DATA: QAFinding[] = [
  { id: 'qf-01', title: 'Inconsistent KSB Assessment Criteria', category: 'KSB', severity: 'Major', status: 'In Progress', raisedBy: 'QA Lead', date: '5 Jun', description: 'Three assessors applied different minimum evidence thresholds for KSB validation. No standardised guidance exists.', actionPlan: 'Develop and publish standardised KSB assessment criteria. Train all assessors. Review all affected validations.', owner: 'Emma Clarke', dueDate: '20 Jun', daysRemaining: 14 },
  { id: 'qf-02', title: 'OTJH Verification Gaps', category: 'OTJH', severity: 'Critical', status: 'Open', raisedBy: 'QA Officer', date: '4 Jun', description: '25% of OTJH entries lack proper verification (attendance record or employer sign-off). Funding compliance risk.', actionPlan: 'Implement mandatory dual verification. Audit all Q2 OTJH entries. Update system validation rules.', owner: 'James Whitfield', dueDate: '18 Jun', daysRemaining: 12 },
  { id: 'qf-03', title: 'Module Version Control Missing', category: 'Module', severity: 'Minor', status: 'Resolved', raisedBy: 'QA Officer', date: '3 Jun', description: 'Two curriculum modules were updated without version control. Historical versions not recoverable.', actionPlan: 'Implement version control system. Train curriculum team. Review all module changes.', owner: 'Sarah Chen', dueDate: '10 Jun', daysRemaining: 0 },
  { id: 'qf-04', title: 'Progress Review Quality Variance', category: 'Progress', severity: 'Major', status: 'In Progress', raisedBy: 'QA Lead', date: '2 Jun', description: 'Progress review quality varies significantly between coaches. Some reviews lack actionable next steps.', actionPlan: 'Create review template with mandatory sections. QA all reviews for 2 months. Coach training on quality standards.', owner: 'Emma Clarke', dueDate: '30 Jun', daysRemaining: 24 },
  { id: 'qf-05', title: 'Evidence Pack Completeness', category: 'Evidence', severity: 'Minor', status: 'Open', raisedBy: 'QA Officer', date: '1 Jun', description: '12% of evidence submissions lack clear KSB linkage. Learners not consistently mapping evidence to standards.', actionPlan: 'Update submission guidance. Add KSB selector to upload flow. Review and retrain affected learners.', owner: 'David Thompson', dueDate: '15 Jun', daysRemaining: 9 },
  { id: 'qf-06', title: 'Employer Sign-off Delays', category: 'Compliance', severity: 'Observation', status: 'Closed', raisedBy: 'QA Officer', date: '31 May', description: 'Average employer sign-off time increased from 3 days to 8 days. No process change identified.', actionPlan: 'Monitor trend for another month. Review employer communication. Consider automated reminders.', owner: 'Priya Patel', dueDate: '30 Jun', daysRemaining: 24 },
  { id: 'qf-07', title: 'Sampling Coverage Below Target', category: 'Sampling', severity: 'Major', status: 'In Progress', raisedBy: 'QA Lead', date: '30 May', description: 'Q2 sampling achieved 8% coverage vs 15% target. High-risk learners underrepresented.', actionPlan: 'Increase Q3 sampling to 20%. Prioritise high-risk learners. Report to leadership.', owner: 'QA Lead', dueDate: '15 Jun', daysRemaining: 9 },
  { id: 'qf-08', title: 'Report Formatting Inconsistency', category: 'Report', severity: 'Observation', status: 'Resolved', raisedBy: 'QA Officer', date: '29 May', description: 'Internal reports use different formatting and branding standards. No template enforced.', actionPlan: 'Create standard report template. Update all authors. Review existing reports.', owner: 'James Whitfield', dueDate: '12 Jun', daysRemaining: 0 },
];

const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  Critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  Major: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  Minor: { bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-300' },
  Observation: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
};

const statusConfig: Record<string, { bg: string; text: string }> = {
  Open: { bg: 'bg-red-100', text: 'text-red-700' },
  'In Progress': { bg: 'bg-primary-100', text: 'text-primary-700' },
  Resolved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Closed: { bg: 'bg-foreground-100', text: 'text-foreground-500' },
};

export default function QAFindingsPage() {
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = FINDINGS_DATA.filter(f => {
    const sevMatch = filterSeverity === 'All' || f.severity === filterSeverity;
    const statusMatch = filterStatus === 'All' || f.status === filterStatus;
    return sevMatch && statusMatch;
  });

  const stats = {
    open: FINDINGS_DATA.filter(f => f.status === 'Open').length,
    inProgress: FINDINGS_DATA.filter(f => f.status === 'In Progress').length,
    resolved: FINDINGS_DATA.filter(f => f.status === 'Resolved').length,
    closed: FINDINGS_DATA.filter(f => f.status === 'Closed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="QA Findings" pageSubtitle="Document and track QA findings with action plans and resolution tracking"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="QA Findings"
          description={`${stats.open} open. ${stats.inProgress} in progress. ${stats.resolved} resolved. ${stats.closed} closed.`}
          icon="ri-search-eye-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20quality%20audit%20findings%20magnifying%20glass%20inspection%20checklist%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-findings-hero&orientation=landscape"
          imageAlt="QA Findings"
          stats={[
            { label: 'Open', value: String(stats.open), variant: 'danger' },
            { label: 'In Progress', value: String(stats.inProgress) },
            { label: 'Resolved', value: String(stats.resolved) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open', value: stats.open, icon: 'ri-alert-line', color: 'red' },
            { label: 'In Progress', value: stats.inProgress, icon: 'ri-loader-4-line', color: 'primary' },
            { label: 'Resolved', value: stats.resolved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Closed', value: stats.closed, icon: 'ri-folder-close-line', color: 'foreground' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'red' ? 'bg-red-100 text-red-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Severity:</span>
          {['All', 'Critical', 'Major', 'Minor', 'Observation'].map(s => (
            <button key={s} onClick={() => setFilterSeverity(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterSeverity === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Status:</span>
          {['All', 'Open', 'In Progress', 'Resolved', 'Closed'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map(finding => (
            <div key={finding.id} className={`bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium border-l-2 ${severityConfig[finding.severity].border}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${severityConfig[finding.severity].bg} ${severityConfig[finding.severity].text}`}>{finding.severity}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[finding.status].bg} ${statusConfig[finding.status].text}`}>{finding.status}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{finding.category}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-foreground-400">{finding.date}</span>
                  {finding.daysRemaining > 0 && finding.status !== 'Closed' && finding.status !== 'Resolved' && (
                    <span className={`text-[10px] font-medium ml-2 ${finding.daysRemaining <= 5 ? 'text-red-600' : finding.daysRemaining <= 10 ? 'text-amber-600' : 'text-emerald-600'}`}>{finding.daysRemaining}d left</span>
                  )}
                </div>
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-1">{finding.title}</h4>
              <p className="text-[11px] text-foreground-400 mb-1">Raised by: {finding.raisedBy} &middot; Owner: {finding.owner} &middot; Due: {finding.dueDate}</p>
              <p className="text-[12px] text-foreground-600 leading-relaxed mb-3">{finding.description}</p>
              <div className="bg-primary-50/50 rounded-lg p-3 mb-3">
                <p className="text-[11px] text-primary-700 leading-relaxed">
                  <strong>Action Plan:</strong> {finding.actionPlan}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {finding.status === 'Open' && (
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Start Action</button>
                )}
                {finding.status === 'In Progress' && (
                  <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap">Mark Resolved</button>
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