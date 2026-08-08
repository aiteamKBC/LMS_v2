import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const financeConfig = roleNavMap.finance;

const FUNDING_PROGRAMMES = [
  { programme: 'Business Administrator L3', learners: 48, fundingRate: '£5,000', total: '£240,000', coInvestment: '£24,000', dasCommitment: '£216,000', status: 'Active' },
  { programme: 'Marketing Executive L4', learners: 32, fundingRate: '£5,000', total: '£160,000', coInvestment: '£16,000', dasCommitment: '£144,000', status: 'Active' },
  { programme: 'Software Developer L4', learners: 24, fundingRate: '£15,000', total: '£360,000', coInvestment: '£36,000', dasCommitment: '£324,000', status: 'Active' },
  { programme: 'Early Years Educator L3', learners: 36, fundingRate: '£5,000', total: '£180,000', coInvestment: '£18,000', dasCommitment: '£162,000', status: 'Active' },
  { programme: 'Data Technician L3', learners: 18, fundingRate: '£9,000', total: '£162,000', coInvestment: '£16,200', dasCommitment: '£145,800', status: 'Active' },
  { programme: 'Customer Service L2', learners: 14, fundingRate: '£2,500', total: '£35,000', coInvestment: '£3,500', dasCommitment: '£31,500', status: 'Active' },
];

const MONTHLY_FUNDING = [
  { month: 'Jan', claimed: 72000, target: 75000 },
  { month: 'Feb', claimed: 68000, target: 75000 },
  { month: 'Mar', claimed: 81000, target: 75000 },
  { month: 'Apr', claimed: 74000, target: 75000 },
  { month: 'May', claimed: 79000, target: 75000 },
  { month: 'Jun', claimed: 65000, target: 75000 },
];

const FUNDING_BY_REGION = [
  { region: 'London', learners: 102, funding: '£486,000', pct: 58 },
  { region: 'South East', learners: 38, funding: '£182,000', pct: 22 },
  { region: 'North West', learners: 24, funding: '£114,000', pct: 14 },
  { region: 'West Midlands', learners: 10, funding: '£60,500', pct: 6 },
];

export default function FundingOverviewPage() {
  const [search, setSearch] = useState('');
  const filtered = FUNDING_PROGRAMMES.filter(p => p.programme.toLowerCase().includes(search.toLowerCase()));
  const totalFunding = FUNDING_PROGRAMMES.reduce((s, p) => s + parseInt(p.total.replace(/[£,]/g, '')), 0);
  const totalCoInvestment = FUNDING_PROGRAMMES.reduce((s, p) => s + parseInt(p.coInvestment.replace(/[£,]/g, '')), 0);
  const totalDas = FUNDING_PROGRAMMES.reduce((s, p) => s + parseInt(p.dasCommitment.replace(/[£,]/g, '')), 0);
  const totalLearners = FUNDING_PROGRAMMES.reduce((s, p) => s + p.learners, 0);

  return (
    <WorkspaceShell
      role="finance" roleLabel={financeConfig.label} navItems={financeConfig.items} workspaceLabel={financeConfig.workspaceLabel}
      pageTitle="Funding Overview" pageSubtitle="Comprehensive funding dashboard with ESFA, co-investment, and DAS tracking"
      userName="David Morgan" userRole="Finance Director"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Funding Overview"
          description={`Total funding: £${totalFunding.toLocaleString()}. ${totalLearners} active learners across ${FUNDING_PROGRAMMES.length} programmes. Co-investment: £${totalCoInvestment.toLocaleString()}, DAS commitments: £${totalDas.toLocaleString()}.`}
          icon="ri-money-pound-circle-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20finance%20funding%20overview%20professional%20modern%20office%20warm%20lighting%20data%20charts&width=400&height=160&seq=funding-hero-01&orientation=landscape"
          imageAlt="Funding Overview"
          stats={[{ label: 'Total Funding', value: `£${(totalFunding / 1000).toFixed(0)}k` }, { label: 'Learners', value: String(totalLearners) }, { label: 'Co-investment', value: `£${(totalCoInvestment / 1000).toFixed(0)}k` }]}
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><AppIcon className="ri-money-pound-circle-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Total Funding</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalFunding.toLocaleString()}</p>
            <p className="text-[11px] text-emerald-600 mt-1">+8.3% vs last year</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><AppIcon className="ri-bank-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Co-investment</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalCoInvestment.toLocaleString()}</p>
            <p className="text-[11px] text-foreground-400 mt-1">5 invoices pending</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><AppIcon className="ri-government-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">DAS Commitments</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalDas.toLocaleString()}</p>
            <p className="text-[11px] text-emerald-600 mt-1">On track</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center"><AppIcon className="ri-user-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Active Learners</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">{totalLearners}</p>
            <p className="text-[11px] text-foreground-400 mt-1">Across {FUNDING_PROGRAMMES.length} programmes</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
          <input type="text" placeholder="Search programmes..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
        </div>

        {/* Funding by Programme */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Funding by Programme</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} programmes</span>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5 font-medium">Programme</th>
                <th className="text-center px-4 py-2.5 font-medium">Learners</th>
                <th className="text-right px-4 py-2.5 font-medium">Rate</th>
                <th className="text-right px-4 py-2.5 font-medium">Total</th>
                <th className="text-right px-4 py-2.5 font-medium">Co-investment</th>
                <th className="text-right px-4 py-2.5 font-medium">DAS</th>
                <th className="text-right px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(prog => (
                <tr key={prog.programme} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                  <td className="px-4 py-3 text-foreground-800 font-medium">{prog.programme}</td>
                  <td className="px-4 py-3 text-center text-foreground-700">{prog.learners}</td>
                  <td className="px-4 py-3 text-right text-foreground-700">{prog.fundingRate}</td>
                  <td className="px-4 py-3 text-right text-foreground-900 font-semibold">{prog.total}</td>
                  <td className="px-4 py-3 text-right text-foreground-700">{prog.coInvestment}</td>
                  <td className="px-4 py-3 text-right text-foreground-700">{prog.dasCommitment}</td>
                  <td className="px-4 py-3 text-right"><span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{prog.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Regional Funding */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Funding by Region</h3>
          <div className="space-y-4">
            {FUNDING_BY_REGION.map(region => (
              <div key={region.region}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-foreground-700">{region.region}</span>
                  <span className="text-[12px] font-medium text-foreground-500">{region.funding} · {region.learners} learners</span>
                </div>
                <div className="h-2 bg-background-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${region.pct}%` }}></div>
                </div>
                <span className="text-[10px] text-foreground-400">{region.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}