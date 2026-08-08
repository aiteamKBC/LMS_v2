import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const REPORT_CATEGORIES = [
  {
    category: 'Executive Reports',
    icon: 'ri-bar-chart-box-line',
    reports: [
      { name: 'Executive Summary Dashboard', format: 'PDF / Dashboard', frequency: 'Monthly', description: 'One-page KPI summary for governing body and board' },
      { name: 'Quarterly Performance Report', format: 'PDF', frequency: 'Quarterly', description: 'Comprehensive performance analysis across all metrics' },
      { name: 'Annual Impact Report', format: 'PDF', frequency: 'Annual', description: 'Year-end impact and outcomes for stakeholders' },
      { name: 'Board Presentation Pack', format: 'PowerPoint', frequency: 'Quarterly', description: 'Presentation-ready slides for board meetings' },
    ],
  },
  {
    category: 'Cohort & Programme Reports',
    icon: 'ri-group-line',
    reports: [
      { name: 'Cohort Performance Report', format: 'PDF / Excel', frequency: 'Monthly', description: 'Detailed performance by cohort with trend analysis' },
      { name: 'Programme Comparison Report', format: 'Excel', frequency: 'Quarterly', description: 'Side-by-side programme performance comparison' },
      { name: 'Learner Progress Summary', format: 'PDF', frequency: 'Monthly', description: 'Aggregated learner progress across all stages' },
      { name: 'Achievement Forecast Report', format: 'PDF / Excel', frequency: 'Monthly', description: 'Predicted achievement pipeline and timelines' },
    ],
  },
  {
    category: 'Attendance & Engagement',
    icon: 'ri-calendar-check-line',
    reports: [
      { name: 'Attendance Trends Report', format: 'PDF', frequency: 'Monthly', description: 'Attendance patterns, catch-up rates and absence analysis' },
      { name: 'Engagement Analysis Report', format: 'PDF / Excel', frequency: 'Monthly', description: 'Multi-metric engagement across LMS, quizzes, clubs' },
      { name: 'Catch-up Compliance Report', format: 'Excel', frequency: 'Weekly', description: 'Outstanding catch-up sessions and overdue actions' },
      { name: 'Self-Paced Completion Report', format: 'PDF', frequency: 'Monthly', description: 'Self-paced learning completion rates and trends' },
    ],
  },
  {
    category: 'OTJH & KSB Reports',
    icon: 'ri-time-line',
    reports: [
      { name: 'OTJH Validation Report', format: 'PDF / Excel', frequency: 'Monthly', description: 'Planned vs claimed vs validated OTJH with gap analysis' },
      { name: 'OTJH Risk Report', format: 'PDF', frequency: 'Monthly', description: 'Learners and cohorts with OTJH shortfalls' },
      { name: 'KSB Progress Report', format: 'PDF / Excel', frequency: 'Monthly', description: 'KSB coverage, validation rates and gap identification' },
      { name: 'Gateway Readiness Report', format: 'PDF', frequency: 'Monthly', description: 'Gateway readiness tracker for all approaching learners' },
    ],
  },
  {
    category: 'Employer Reports',
    icon: 'ri-building-2-line',
    reports: [
      { name: 'Employer Engagement Report', format: 'PDF', frequency: 'Quarterly', description: 'Employer satisfaction, attendance and confirmation metrics' },
      { name: 'Employer Satisfaction Survey Results', format: 'PDF / Excel', frequency: 'Bi-annual', description: 'Detailed survey analysis with trend comparison' },
      { name: 'Employer Risk Report', format: 'PDF', frequency: 'Monthly', description: 'Employers with outstanding actions or declining engagement' },
      { name: 'Workplace Impact Report', format: 'PDF', frequency: 'Quarterly', description: 'Case studies and evidence of apprenticeship impact at work' },
    ],
  },
  {
    category: 'Compliance & QA Reports',
    icon: 'ri-shield-check-line',
    reports: [
      { name: 'Compliance Risk Report', format: 'PDF', frequency: 'Monthly', description: 'Risk matrix across all compliance areas with RAG status' },
      { name: 'QA Sampling Report', format: 'PDF / Excel', frequency: 'Monthly', description: 'Sample plans, findings, severity and closure analysis' },
      { name: 'Ofsted Evidence Pack', format: 'PDF', frequency: 'Quarterly', description: 'Compiled Ofsted evidence across all inspection categories' },
      { name: 'SAR/QIP Evidence Export', format: 'PDF / Excel', frequency: 'Quarterly', description: 'SAR completeness and QIP progress for governance' },
    ],
  },
];

export default function LeadershipReportsPage() {
  const totalReports = REPORT_CATEGORIES.reduce((s, c) => s + c.reports.length, 0);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Reports" pageSubtitle="Executive reports, cohort reports, programme reports, attendance, engagement, OTJH, KSB, employer, compliance, QA, Ofsted and SAR/QIP exports" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Reporting & Insights" description={`${REPORT_CATEGORIES.length} categories · ${totalReports} reports available · Generate, download and schedule`} icon="ri-bar-chart-box-line" stats={[{ label: 'Categories', value: String(REPORT_CATEGORIES.length) }, { label: 'Reports', value: String(totalReports) }, { label: 'Formats', value: 'PDF, Excel, PPT' }]} />

        {/* Report Categories */}
        <div className="space-y-4">
          {REPORT_CATEGORIES.map(rc => (
            <div key={rc.category} className="bg-background-50 rounded-xl border border-background-200/50 p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className={`${rc.icon} text-sm`}></AppIcon></span>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{rc.category}</h3>
                <span className="text-[10px] text-foreground-400">{rc.reports.length} reports</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {rc.reports.map(r => (
                  <div key={r.name} className="p-3 rounded-lg border border-foreground-200 hover:border-primary-200/60 transition-smooth cursor-pointer group">
                    <p className="text-[12px] font-semibold text-foreground-900 mb-1 group-hover:text-primary-600 transition-smooth">{r.name}</p>
                    <p className="text-[10px] text-foreground-400 leading-tight mb-2">{r.description}</p>
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="bg-background-100/70 px-2 py-0.5 rounded text-foreground-500">{r.format}</span>
                      <span className="text-foreground-400">{r.frequency}</span>
                    </div>
                    <button className="mt-2 w-full flex items-center justify-center gap-1.5 bg-background-100 hover:bg-primary-100 text-foreground-600 hover:text-primary-700 rounded-lg py-1.5 text-[10px] font-medium transition-smooth cursor-pointer">
                      <AppIcon className="ri-download-line text-xs"></AppIcon> Generate
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}