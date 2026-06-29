import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const financeConfig = roleNavMap.finance;

interface Report {
  id: string;
  name: string;
  description: string;
  category: string;
  lastGenerated: string;
  frequency: string;
  format: string;
  size: string;
  status: 'Ready' | 'Generating' | 'Scheduled';
}

const REPORTS: Report[] = [
  { id: 'FR-001', name: 'P&L Statement', description: 'Profit and loss statement for the current financial year', category: 'Financial', lastGenerated: 'Today', frequency: 'Monthly', format: 'PDF', size: '1.2 MB', status: 'Ready' },
  { id: 'FR-002', name: 'Funding Utilisation Report', description: 'ESFA funding claim breakdown by programme and cohort', category: 'Funding', lastGenerated: 'Yesterday', frequency: 'Monthly', format: 'Excel', size: '3.4 MB', status: 'Ready' },
  { id: 'FR-003', name: 'Co-investment Summary', description: 'Employer co-investment payments and outstanding balances', category: 'Co-investment', lastGenerated: 'Yesterday', frequency: 'Monthly', format: 'PDF', size: '0.8 MB', status: 'Ready' },
  { id: 'FR-004', name: 'DAS Reconciliation', description: 'Digital Apprenticeship Service reconciliation report', category: 'DAS', lastGenerated: '3 Jun 2026', frequency: 'Weekly', format: 'Excel', size: '2.1 MB', status: 'Ready' },
  { id: 'FR-005', name: 'Budget Variance Report', description: 'Budget vs actual spend analysis by department', category: 'Budget', lastGenerated: '3 Jun 2026', frequency: 'Monthly', format: 'PDF', size: '1.5 MB', status: 'Ready' },
  { id: 'FR-006', name: 'Invoice Ageing Report', description: 'Outstanding invoice analysis by age and employer', category: 'Invoicing', lastGenerated: '1 Jun 2026', frequency: 'Weekly', format: 'PDF', size: '0.9 MB', status: 'Ready' },
  { id: 'FR-007', name: 'Quarterly Forecast', description: 'Revenue and expenditure forecast for next quarter', category: 'Forecast', lastGenerated: '1 Jun 2026', frequency: 'Quarterly', format: 'Excel', size: '2.8 MB', status: 'Ready' },
  { id: 'FR-008', name: 'Audit Pack', description: 'Financial audit pack for external auditors', category: 'Audit', lastGenerated: '28 May 2026', frequency: 'Annual', format: 'PDF', size: '5.6 MB', status: 'Ready' },
  { id: 'FR-009', name: 'Learner Funding Tracker', description: 'Per-learner funding allocation and claim status', category: 'Funding', lastGenerated: '28 May 2026', frequency: 'Monthly', format: 'Excel', size: '4.2 MB', status: 'Ready' },
  { id: 'FR-010', name: 'Employer Payment History', description: 'Complete payment history by employer account', category: 'Payments', lastGenerated: '25 May 2026', frequency: 'Monthly', format: 'PDF', size: '1.8 MB', status: 'Ready' },
];

export default function FinanceReportsPage() {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = REPORTS.filter(r => {
    const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const categories = ['all', ...Array.from(new Set(REPORTS.map(r => r.category)))];

  return (
    <WorkspaceShell
      role="finance" roleLabel={financeConfig.label} navItems={financeConfig.items} workspaceLabel={financeConfig.workspaceLabel}
      pageTitle="Reports" pageSubtitle="Financial reports including P&L, funding utilisation, and audit packs"
      userName="David Morgan" userRole="Finance Director"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Financial Reports"
          description={`${REPORTS.length} reports available. ${REPORTS.filter(r => r.status === 'Ready').length} ready to download. Generate, schedule, and distribute financial reports across the organisation.`}
          icon="ri-bar-chart-box-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20financial%20reports%20analytics%20modern%20office%20warm%20lighting%20charts&width=400&height=160&seq=finance-reports-hero-01&orientation=landscape"
          imageAlt="Financial Reports"
          stats={[{ label: 'Reports', value: String(REPORTS.length) }, { label: 'Ready', value: String(REPORTS.filter(r => r.status === 'Ready').length) }, { label: 'Categories', value: String(categories.length - 1) }]}
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search reports..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Reports List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Available Reports</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} reports</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(report => (
              <div key={report.id} className="p-4 flex items-center gap-4">
                <span className="w-10 h-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                  <i className="ri-file-chart-line text-sm"></i>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] font-semibold text-foreground-900">{report.name}</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{report.category}</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{report.status}</span>
                  </div>
                  <p className="text-[11px] text-foreground-500">{report.description}</p>
                  <div className="flex items-center gap-3 text-[10px] text-foreground-400 mt-1">
                    <span>Frequency: {report.frequency}</span>
                    <span>Format: {report.format}</span>
                    <span>Size: {report.size}</span>
                    <span>Last: {report.lastGenerated}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-play-line mr-1"></i> Generate
                  </button>
                  <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-download-line mr-1"></i> Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}