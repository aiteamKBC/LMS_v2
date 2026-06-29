import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { GENERATED_REPORTS } from '@/mocks/generated-reports';
import ReportGeneratorModal from './components/ReportGeneratorModal';

const coachNav = roleNavMap.coach;

interface Report {
  id: string;
  title: string;
  description: string;
  category: string;
  lastGenerated: string;
  format: string;
  frequency: string;
  coachSpecific: boolean;
}

const REPORTS: Report[] = [
  { id: 'cr-01', title: 'Caseload Progress Summary', description: 'Comprehensive overview of all learners in your caseload with progress, attendance, OTJH and KSB metrics', category: 'Caseload', lastGenerated: '8 Jun 2026', format: 'PDF / Excel', frequency: 'Weekly', coachSpecific: true },
  { id: 'cr-02', title: 'At-risk Learner Report', description: 'Detailed breakdown of at-risk learners with risk flags, intervention history, escalation status and trend analysis', category: 'Risk', lastGenerated: '7 Jun 2026', format: 'PDF', frequency: 'Weekly', coachSpecific: true },
  { id: 'cr-03', title: 'OTJH Compliance Report', description: 'Off-the-job training hours data for your caseload with pace tracking, shortfall alerts and employer confirmation status', category: 'Compliance', lastGenerated: '5 Jun 2026', format: 'PDF / Excel', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-04', title: 'Attendance & Catch-up Report', description: 'Session attendance records, absence patterns and catch-up completion for all assigned learners', category: 'Attendance', lastGenerated: '6 Jun 2026', format: 'PDF', frequency: 'Weekly', coachSpecific: true },
  { id: 'cr-05', title: 'Intervention Log', description: 'Complete history of all coaching interventions, outcomes and follow-up actions across your caseload', category: 'Interventions', lastGenerated: '8 Jun 2026', format: 'PDF / Excel', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-06', title: 'KSB Progress by Learner', description: 'Knowledge, Skills and Behaviours progression for each learner with gateway readiness indicators', category: 'Progress', lastGenerated: '4 Jun 2026', format: 'PDF', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-07', title: 'Monthly Coaching Summary', description: 'Summary of all coaching sessions, progress reviews, and employer contacts for the month', category: 'Coaching', lastGenerated: '1 Jun 2026', format: 'PDF', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-08', title: 'Employer Engagement Report', description: 'Record of all employer contacts, meetings, and actions for your assigned employer accounts', category: 'Employer', lastGenerated: '3 Jun 2026', format: 'PDF / Excel', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-09', title: 'Evidence Validation Status', description: 'Status of all evidence submissions in your validation queue with turnaround times and quality ratings', category: 'Evidence', lastGenerated: '8 Jun 2026', format: 'PDF', frequency: 'Weekly', coachSpecific: true },
  { id: 'cr-10', title: 'Gateway Readiness Dashboard', description: 'Gateway readiness assessment for all learners approaching EPA with criteria completion tracking', category: 'Gateway & EPA', lastGenerated: '2 Jun 2026', format: 'PDF', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-11', title: 'Learner Engagement Trends', description: 'Engagement scoring trends with comparison to programme averages and historical data', category: 'Engagement', lastGenerated: '7 Jun 2026', format: 'PDF / Excel', frequency: 'Monthly', coachSpecific: true },
  { id: 'cr-12', title: 'Coaching Workload Report', description: 'Your coaching activity summary including session counts, marking volumes, and time allocation', category: 'Workload', lastGenerated: '1 Jun 2026', format: 'PDF', frequency: 'Monthly', coachSpecific: true },
];

export default function CoachReports() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeReportId, setActiveReportId] = useState<string | null>(null);

  const filtered = REPORTS.filter(r => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    return true;
  });

  const categories = [...new Set(REPORTS.map(r => r.category))];

  const activeReport = activeReportId ? GENERATED_REPORTS[activeReportId] || null : null;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Reports" pageSubtitle="Generate caseload reports, progress summaries, and compliance documentation" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-bar-chart-box-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Reports</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{REPORTS.length} reports</strong> available across {categories.length} categories</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 flex-wrap">
            {[{ key: 'all', label: 'All' }, ...categories.map(c => ({ key: c, label: c }))].map(f => (
              <button key={f.key} onClick={() => setCategoryFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(report => {
            const catIcon = report.category === 'Caseload' ? 'ri-group-line' : report.category === 'Risk' ? 'ri-alert-line' : report.category === 'Compliance' ? 'ri-shield-check-line' : report.category === 'Attendance' ? 'ri-calendar-check-line' : report.category === 'Interventions' ? 'ri-chat-smile-2-line' : report.category === 'Progress' ? 'ri-bar-chart-line' : report.category === 'Coaching' ? 'ri-heart-line' : report.category === 'Employer' ? 'ri-building-2-line' : report.category === 'Evidence' ? 'ri-folder-line' : report.category === 'Gateway & EPA' ? 'ri-flag-line' : report.category === 'Engagement' ? 'ri-line-chart-line' : 'ri-pie-chart-line';
            return (
              <div key={report.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0"><i className={`${catIcon} text-lg`}></i></span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground-900">{report.title}</h3>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{report.category}</span>
                  </div>
                </div>
                <p className="text-[12px] text-foreground-500 mb-4">{report.description}</p>
                <div className="flex items-center gap-x-4 gap-y-1 text-[10px] text-foreground-400 mb-3 flex-wrap">
                  <span><i className="ri-calendar-line mr-0.5"></i> {report.lastGenerated}</span>
                  <span><i className="ri-file-line mr-0.5"></i> {report.format}</span>
                  <span><i className="ri-loop-left-line mr-0.5"></i> {report.frequency}</span>
                </div>
                <button onClick={() => setActiveReportId(report.id)} className="w-full px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-download-line mr-1"></i> Generate Report
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ReportGeneratorModal report={activeReport} onClose={() => setActiveReportId(null)} />
    </WorkspaceShell>
  );
}