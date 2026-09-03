import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { financeNavItems } from '@/mocks/navigation';
import { roleNavMap } from '@/mocks/navigation';

const financeConfig = roleNavMap.finance;

const STATS = [
  { label: 'Total Funding (YTD)', value: '£842,500', icon: 'ri-money-pound-circle-line', change: '+8.3%', trend: 'up', colour: 'emerald' },
  { label: 'Co-investment Due', value: '£47,200', icon: 'ri-bank-line', change: '5 invoices', trend: 'neutral', colour: 'amber' },
  { label: 'DAS Payments', value: '£623,000', icon: 'ri-government-line', change: 'On track', trend: 'up', colour: 'emerald' },
  { label: 'Employer Contribution', value: '£172,300', icon: 'ri-building-2-line', change: '+12.1%', trend: 'up', colour: 'emerald' },
  { label: 'Outstanding Invoices', value: '£31,800', icon: 'ri-bill-line', change: '3 overdue', trend: 'down', colour: 'red' },
  { label: 'Budget Remaining', value: '£215,900', icon: 'ri-pie-chart-2-line', change: '74% utilised', trend: 'neutral', colour: 'accent' },
];

const RECENT_INVOICES = [
  { id: 'INV-0421', employer: 'Kent County Council', amount: '£21,400', date: '05 Jun 2026', status: 'Paid' },
  { id: 'INV-0419', employer: 'Tim Hortons UK', amount: '£10,700', date: '02 Jun 2026', status: 'Paid' },
  { id: 'INV-0417', employer: 'Medway NHS Trust', amount: '£8,400', date: '28 May 2026', status: 'Pending' },
  { id: 'INV-0415', employer: 'Canterbury City Council', amount: '£14,200', date: '22 May 2026', status: 'Overdue' },
  { id: 'INV-0412', employer: 'Ashford Borough Council', amount: '£6,300', date: '15 May 2026', status: 'Paid' },
];

const FUNDING_BREAKDOWN = [
  { programme: 'Business Administrator L3', learners: 48, fundingRate: '£5,000', total: '£240,000', status: 'Active' },
  { programme: 'Marketing Executive L4', learners: 32, fundingRate: '£5,000', total: '£160,000', status: 'Active' },
  { programme: 'Software Developer L4', learners: 24, fundingRate: '£15,000', total: '£360,000', status: 'Active' },
  { programme: 'Early Years Educator L3', learners: 36, fundingRate: '£5,000', total: '£180,000', status: 'Active' },
  { programme: 'Data Technician L3', learners: 18, fundingRate: '£9,000', total: '£162,000', status: 'Active' },
  { programme: 'Customer Service L2', learners: 14, fundingRate: '£2,500', total: '£35,000', status: 'Active' },
];

const BUDGET_BARS = [
  { category: 'Learner Support', spent: 68, color: 'bg-primary-500' },
  { category: 'Curriculum Dev', spent: 82, color: 'bg-accent-500' },
  { category: 'Compliance & QA', spent: 45, color: 'bg-secondary-500' },
  { category: 'Staff Training', spent: 73, color: 'bg-emerald-500' },
  { category: 'Technology', spent: 91, color: 'bg-amber-500' },
];

export default function FinanceWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'funding' | 'budgets'>('overview');

  return (
    <WorkspaceShell
      role="finance"
      roleLabel={financeConfig.label}
      navItems={financeConfig.items}
      pageTitle="Finance Workspace"
      pageSubtitle="Funding overview, invoices, and financial management"
      userName="David Morgan"
      userRole="Finance Director"
      workspaceLabel={financeConfig.workspaceLabel}
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Finance Workspace"
          description="Funding overview, DAS tracking, co-investment management, and apprenticeship financial reporting"
          icon="ri-money-pound-circle-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20finance%20banking%20funding%20money%20pound%20sterling%20professional%20purple%20gold%20accent%20editorial%20photography%20modern%20clean%20minimalist%20corporate&width=400&height=160&seq=finance-hero-01&orientation=landscape"
          imageAlt="Finance Workspace"
          stats={[
            { label: 'Total Funding', value: '£842,500', variant: 'success' },
            { label: 'Outstanding', value: '£31,800', variant: 'danger' },
            { label: 'Budget Left', value: '£215,900' },
          ]}
        />
        {/* Stats Banner */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="coach-metric-card">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  stat.colour === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                  stat.colour === 'amber' ? 'bg-amber-50 text-amber-600' :
                  stat.colour === 'red' ? 'bg-red-50 text-red-600' :
                  'bg-accent-50 text-accent-600'
                }`}>
                  <AppIcon className={`${stat.icon} text-xs`}></AppIcon>
                </span>
              </div>
              <p className="text-2xl font-heading font-semibold text-foreground-950">{stat.value}</p>
              <p className="text-[11px] text-foreground-500 mt-1">{stat.label}</p>
              <p className={`text-[10px] font-medium mt-0.5 ${
                stat.trend === 'up' ? 'text-emerald-600' : stat.trend === 'down' ? 'text-red-600' : 'text-foreground-500'
              }`}>{stat.change}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit">
          {(['overview', 'invoices', 'funding', 'budgets'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {tab === 'overview' ? 'Overview' : tab === 'invoices' ? 'Invoices' : tab === 'funding' ? 'Funding Allocation' : 'Budget Tracking'}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recent Invoices */}
            {activeTab !== 'budgets' && (
              <div className="bg-background-50 border border-foreground-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-background-100">
                  <h3 className="text-[14px] font-heading font-semibold text-foreground-900">
                    {activeTab === 'invoices' ? 'All Invoices' : 'Recent Invoices'}
                  </h3>
                  <Link to="/finance/invoices" className="text-[12px] text-primary-600 font-medium hover:text-primary-700">View all</Link>
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5 font-medium">Invoice</th>
                      <th className="text-left px-5 py-2.5 font-medium">Employer</th>
                      <th className="text-right px-5 py-2.5 font-medium">Amount</th>
                      <th className="text-left px-5 py-2.5 font-medium">Date</th>
                      <th className="text-right px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RECENT_INVOICES.map((inv) => (
                      <tr key={inv.id} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                        <td className="px-5 py-3 text-foreground-800 font-medium">{inv.id}</td>
                        <td className="px-5 py-3 text-foreground-700">{inv.employer}</td>
                        <td className="px-5 py-3 text-right text-foreground-900 font-medium">{inv.amount}</td>
                        <td className="px-5 py-3 text-foreground-500">{inv.date}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' :
                            inv.status === 'Pending' ? 'bg-amber-50 text-amber-700' :
                            'bg-red-50 text-red-700'
                          }`}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Funding Breakdown */}
            {activeTab !== 'invoices' && (
              <div className="bg-background-50 border border-foreground-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-background-100">
                  <h3 className="text-[14px] font-heading font-semibold text-foreground-900">Funding per Programme</h3>
                  <Link to="/finance/funding" className="text-[12px] text-primary-600 font-medium hover:text-primary-700">View all</Link>
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5 font-medium">Programme</th>
                      <th className="text-center px-5 py-2.5 font-medium">Learners</th>
                      <th className="text-right px-5 py-2.5 font-medium">Rate</th>
                      <th className="text-right px-5 py-2.5 font-medium">Total</th>
                      <th className="text-right px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FUNDING_BREAKDOWN.map((prog) => (
                      <tr key={prog.programme} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                        <td className="px-5 py-3 text-foreground-800 font-medium">{prog.programme}</td>
                        <td className="px-5 py-3 text-center text-foreground-700">{prog.learners}</td>
                        <td className="px-5 py-3 text-right text-foreground-700">{prog.fundingRate}</td>
                        <td className="px-5 py-3 text-right text-foreground-900 font-semibold">{prog.total}</td>
                        <td className="px-5 py-3 text-right">
                          <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{prog.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Budget Tracking */}
            {activeTab !== 'invoices' && activeTab !== 'funding' && (
              <div className="bg-background-50 border border-foreground-200 rounded-xl p-5">
                <h3 className="text-[14px] font-heading font-semibold text-foreground-900 mb-4">Budget Utilisation</h3>
                <div className="space-y-4">
                  {BUDGET_BARS.map((item) => (
                    <div key={item.category}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[12px] text-foreground-700">{item.category}</span>
                        <span className={`text-[12px] font-medium ${
                          item.spent > 85 ? 'text-red-600' : 'text-foreground-500'
                        }`}>{item.spent}%</span>
                      </div>
                      <div className="h-2 bg-background-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-smooth ${item.color}`} style={{ width: `${item.spent}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl p-5">
              <h3 className="text-[14px] font-heading font-semibold text-foreground-900 mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {[
                  { label: 'Generate Invoice', icon: 'ri-bill-line' },
                  { label: 'Funding Report', icon: 'ri-bar-chart-2-line' },
                  { label: 'Co-investment Tracker', icon: 'ri-money-pound-circle-line' },
                  { label: 'Export for Audit', icon: 'ri-download-line' },
                ].map((action) => (
                  <button key={action.label} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer">
                    <AppIcon className={`${action.icon} text-foreground-400`}></AppIcon>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Upcoming Deadlines */}
            <div className="bg-background-50 border border-foreground-200 rounded-xl p-5">
              <h3 className="text-[14px] font-heading font-semibold text-foreground-900 mb-3">Upcoming Deadlines</h3>
              <div className="space-y-3">
                {[
                  { label: 'Q2 Funding Claim', date: '15 Jun 2026', urgent: true },
                  { label: 'Employer Co-investment Due', date: '20 Jun 2026', urgent: false },
                  { label: 'ILR R14 Submission', date: '05 Jul 2026', urgent: true },
                  { label: 'Annual Budget Review', date: '31 Jul 2026', urgent: false },
                ].map((dl) => (
                  <div key={dl.label} className="flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full ${dl.urgent ? 'bg-red-500' : 'bg-foreground-300'}`}></span>
                    <div className="min-w-0">
                      <p className="text-[12px] text-foreground-800 truncate">{dl.label}</p>
                      <p className="text-[11px] text-foreground-400">{dl.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
