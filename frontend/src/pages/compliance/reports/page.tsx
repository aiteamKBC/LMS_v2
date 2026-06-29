import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

const REPORT_CATEGORIES = [
  {
    label: 'New Starter Reports',
    icon: 'ri-user-add-line',
    items: ['Monthly New Starter Summary', 'Source Breakdown Report', 'Cohort Assignment Status', 'Time-to-Assignment Analysis'],
  },
  {
    label: 'Onboarding Progress',
    icon: 'ri-road-map-line',
    items: ['Onboarding Stage Progression', 'Pipeline Velocity Report', 'Stage Duration Analysis', 'Learner Onboarding Status'],
  },
  {
    label: 'Eligibility Reports',
    icon: 'ri-checkbox-circle-line',
    items: ['Eligibility Decision Summary', 'Residency Test Outcomes', 'Right to Work Verification Log', 'Funding Eligibility Audit'],
  },
  {
    label: 'Document Reports',
    icon: 'ri-folder-line',
    items: ['Document Completeness by Learner', 'Missing Documents Register', 'Document Expiry Tracker', 'Policy Acknowledgement Status'],
  },
  {
    label: 'DAS & ILR Readiness',
    icon: 'ri-database-2-line',
    items: ['DAS Readiness Dashboard', 'ILR Field Validation Report', 'DAS/ILR Reconciliation', 'Employer Approval Status'],
  },
  {
    label: 'Funding Risk Reports',
    icon: 'ri-alert-line',
    items: ['Funding Risk Matrix', 'High Risk Learner Register', 'Funding at Risk Summary', 'Risk Trend Analysis'],
  },
  {
    label: 'Enrolment Performance',
    icon: 'ri-bar-chart-box-line',
    items: ['Enrolment Team KPI Dashboard', 'Time-to-Activation Report', 'Weekly Enrolment Summary', 'SLA Compliance Report'],
  },
];

export default function ReportsPage() {
  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Reports" pageSubtitle="New starter reports, onboarding progress, eligibility, documents, DAS/ILR readiness and funding risk reports" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Enrolment Reports" description="Comprehensive reporting suite covering new starters, onboarding progress, eligibility, documents, DAS/ILR readiness, funding risk and enrolment team performance." icon="ri-bar-chart-box-line" imageUrl="https://readdy.ai/api/search-image?query=professional%20business%20reports%20analytics%20dashboard%20charts%20data%20visualisation%20modern%20office%20warm%20lighting%20editorial&width=400&height=160&seq=enrolment-reports-hero&orientation=landscape" imageAlt="Enrolment reports" stats={[{ label: 'Report Categories', value: '7' }, { label: 'Reports', value: '28' }, { label: 'Last Updated', value: '11 Jun 2026' }]} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_CATEGORIES.map(cat => (
            <div key={cat.label} className="bg-background-50 rounded-xl border border-background-200/50 p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                  <i className={`${cat.icon} text-sm`}></i>
                </span>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{cat.label}</h3>
              </div>
              <div className="space-y-2">
                {cat.items.map(item => (
                  <a key={item} href="#" className="flex items-center justify-between p-2.5 rounded-lg hover:bg-background-100 transition-smooth cursor-pointer group">
                    <span className="text-[12px] text-foreground-600 group-hover:text-primary-700">{item}</span>
                    <i className="ri-download-line text-foreground-300 group-hover:text-primary-500 text-sm"></i>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <div className="flex items-center gap-3 mb-3">
            <i className="ri-information-line text-foreground-400"></i>
            <p className="text-[12px] text-foreground-500">Reports are generated daily at 06:00 GMT. All reports can be exported as PDF, CSV or Excel. Contact the MIS team for custom report requests.</p>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}