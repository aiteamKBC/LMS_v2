import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const financeConfig = roleNavMap.finance;

const BUDGETS = [
  { category: 'Learner Support', budget: 85000, spent: 57800, remaining: 27200, pct: 68, variance: -2, status: 'On Track' },
  { category: 'Curriculum Development', budget: 62000, spent: 50840, remaining: 11160, pct: 82, variance: 5, status: 'Over Budget' },
  { category: 'Compliance & QA', budget: 45000, spent: 20250, remaining: 24750, pct: 45, variance: -8, status: 'Under Budget' },
  { category: 'Staff Training', budget: 38000, spent: 27740, remaining: 10260, pct: 73, variance: 1, status: 'On Track' },
  { category: 'Technology', budget: 55000, spent: 50050, remaining: 4950, pct: 91, variance: 12, status: 'Over Budget' },
  { category: 'Marketing', budget: 28000, spent: 16800, remaining: 11200, pct: 60, variance: -5, status: 'Under Budget' },
  { category: 'Facilities', budget: 42000, spent: 29400, remaining: 12600, pct: 70, variance: 0, status: 'On Track' },
  { category: 'Administration', budget: 32000, spent: 25600, remaining: 6400, pct: 80, variance: 3, status: 'Over Budget' },
];

const QUARTERLY_VARIANCE = [
  { quarter: 'Q1', budget: 180000, actual: 172000, variance: -8000 },
  { quarter: 'Q2', budget: 195000, actual: 201000, variance: 6000 },
  { quarter: 'Q3', budget: 190000, actual: 185000, variance: -5000 },
  { quarter: 'Q4', budget: 210000, actual: 215000, variance: 5000 },
];

export default function BudgetsPage() {
  const [search, setSearch] = useState('');
  const filtered = BUDGETS.filter(b => b.category.toLowerCase().includes(search.toLowerCase()));

  const totalBudget = BUDGETS.reduce((s, b) => s + b.budget, 0);
  const totalSpent = BUDGETS.reduce((s, b) => s + b.spent, 0);
  const totalRemaining = totalBudget - totalSpent;
  const overallPct = Math.round((totalSpent / totalBudget) * 100);

  return (
    <WorkspaceShell
      role="finance" roleLabel={financeConfig.label} navItems={financeConfig.items} workspaceLabel={financeConfig.workspaceLabel}
      pageTitle="Budgets" pageSubtitle="Manage departmental budgets with forecasting and variance analysis"
      userName="David Morgan" userRole="Finance Director"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Budget Management"
          description={`£${totalBudget.toLocaleString()} total budget. £${totalSpent.toLocaleString()} spent (${overallPct}%), £${totalRemaining.toLocaleString()} remaining. ${BUDGETS.filter(b => b.status === 'Over Budget').length} categories over budget.`}
          icon="ri-pie-chart-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20budget%20management%20finance%20charts%20modern%20office%20warm%20lighting&width=400&height=160&seq=budgets-hero-01&orientation=landscape"
          imageAlt="Budgets"
          stats={[{ label: 'Budget', value: `£${(totalBudget / 1000).toFixed(0)}k` }, { label: 'Spent', value: `${overallPct}%` }, { label: 'Over Budget', value: String(BUDGETS.filter(b => b.status === 'Over Budget').length), variant: 'danger' }]}
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><AppIcon className="ri-pie-chart-2-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Total Budget</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalBudget.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><AppIcon className="ri-arrow-down-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Spent</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalSpent.toLocaleString()}</p>
            <p className="text-[11px] text-amber-600 mt-1">{overallPct}% of budget</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><AppIcon className="ri-arrow-up-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Remaining</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalRemaining.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><AppIcon className="ri-error-warning-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Over Budget</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">{BUDGETS.filter(b => b.status === 'Over Budget').length}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
          <input type="text" placeholder="Search budgets..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
        </div>

        {/* Budget Breakdown */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Budget Utilisation</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} categories</span>
          </div>
          <div className="space-y-4">
            {filtered.map(b => (
              <div key={b.category}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-foreground-700">{b.category}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.status === 'On Track' ? 'bg-primary-100 text-primary-700' : b.status === 'Under Budget' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{b.status}</span>
                  </div>
                  <span className="text-[12px] font-medium text-foreground-500">{b.pct}%</span>
                </div>
                <div className="h-2 bg-background-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-smooth ${b.pct > 90 ? 'bg-red-500' : b.pct > 75 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${b.pct}%` }}></div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-foreground-400">£{b.spent.toLocaleString()} of £{b.budget.toLocaleString()}</span>
                  <span className="text-[10px] text-foreground-400">Remaining: £{b.remaining.toLocaleString()}</span>
                </div>
                {b.variance !== 0 && (
                  <span className={`text-[10px] font-medium ${b.variance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {b.variance > 0 ? `+${b.variance}% over` : `${b.variance}% under`} forecast
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Quarterly Variance */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Quarterly Variance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {QUARTERLY_VARIANCE.map(q => (
              <div key={q.quarter} className="bg-background-100/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-semibold text-foreground-900">{q.quarter}</span>
                  <span className={`text-[11px] font-medium ${q.variance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {q.variance > 0 ? '+' : ''}£{Math.abs(q.variance).toLocaleString()}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] text-foreground-500">
                  <p>Budget: <span className="text-foreground-700 font-medium">£{q.budget.toLocaleString()}</span></p>
                  <p>Actual: <span className="text-foreground-700 font-medium">£{q.actual.toLocaleString()}</span></p>
                </div>
                <div className="mt-2 h-1.5 bg-background-200 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min((q.actual / q.budget) * 100, 100)}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}