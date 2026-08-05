import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SAFEGUARDING_CASES } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const allCases = SAFEGUARDING_CASES;
const activeCases = allCases.filter(c => c.status !== 'Closed' && c.status !== 'Archived');
const closedCases = allCases.filter(c => c.status === 'Closed' || c.status === 'Archived');
const highRisk = activeCases.filter(c => c.riskLevel === 'High Risk' || c.riskLevel === 'Immediate Action Required');

const concernTypeCounts = allCases.reduce((acc, c) => {
  acc[c.concernType] = (acc[c.concernType] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

const riskCounts = allCases.reduce((acc, c) => {
  acc[c.riskLevel] = (acc[c.riskLevel] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

const tenantCases = allCases.reduce((acc, c) => {
  acc[c.tenant] = (acc[c.tenant] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

const referralTypes = allCases.reduce((acc, c) => {
  if (c.referralStatus !== 'None') {
    acc[c.referralStatus] = (acc[c.referralStatus] || 0) + 1;
  }
  return acc;
}, {} as Record<string, number>);

export default function SafeguardingReportsPage() {
  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Safeguarding Reports" pageSubtitle="Case analytics, trends, and statutory reporting"
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ReportKpi label="Total Cases" value={allCases.length} sub="all time" icon="ri-folder-line" colour="red" />
          <ReportKpi label="Active Cases" value={activeCases.length} sub="currently open" icon="ri-folder-open-line" colour="amber" />
          <ReportKpi label="High Risk" value={highRisk.length} sub="requires attention" icon="ri-error-warning-line" colour="red" />
          <ReportKpi label="Closed" value={closedCases.length} sub="resolved" icon="ri-check-double-line" colour="emerald" />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* Concern Type Distribution */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Concern Types</h3>
            <div className="space-y-2.5">
              {Object.entries(concernTypeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count], idx) => {
                  const maxCount = Math.max(...Object.values(concernTypeCounts));
                  const colors = ['bg-red-400', 'bg-amber-400', 'bg-orange-400', 'bg-red-300', 'bg-secondary-400', 'bg-amber-300', 'bg-orange-300', 'bg-red-200', 'bg-secondary-300', 'bg-amber-200', 'bg-orange-200', 'bg-red-150'];
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-foreground-700 truncate max-w-[70%]">{type}</span>
                        <span className="text-[10px] font-medium text-foreground-500">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-background-100 overflow-hidden">
                        <div className={`h-full rounded-full ${colors[idx] || 'bg-foreground-300'}`} style={{ width: `${(count / maxCount) * 100}%` }}></div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          {/* Risk Level Distribution */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Risk Level Distribution</h3>
            <div className="space-y-2.5">
              {Object.entries(riskCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([level, count]) => {
                  const maxCount = Math.max(...Object.values(riskCounts));
                  return (
                    <div key={level}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-foreground-700">{level}</span>
                        <span className="text-[10px] font-medium text-foreground-500">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-background-100 overflow-hidden">
                        <div className={`h-full rounded-full ${
                          level === 'Immediate Action Required' ? 'bg-red-500' :
                          level === 'High Risk' ? 'bg-red-400' :
                          level === 'Medium Risk' ? 'bg-amber-400' :
                          level === 'Low Risk' ? 'bg-emerald-400' :
                          level === 'Monitoring' ? 'bg-secondary-400' :
                          level === 'Closed' || level === 'Archived' ? 'bg-foreground-300' :
                          'bg-secondary-400'
                        }`} style={{ width: `${(count / maxCount) * 100}%` }}></div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          {/* Cases by Tenant */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Cases by Tenant</h3>
            <div className="space-y-2.5">
              {Object.entries(tenantCases).map(([tenant, count]) => {
                const maxCount = Math.max(...Object.values(tenantCases));
                return (
                  <div key={tenant}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-foreground-700">{tenant}</span>
                      <span className="text-[10px] font-medium text-foreground-500">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-background-100 overflow-hidden">
                      <div className="h-full rounded-full bg-red-400" style={{ width: `${(count / maxCount) * 100}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Referral Status */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Referral Status</h3>
            <div className="space-y-2.5">
              {Object.entries(referralTypes).map(([status, count]) => {
                const maxCount = Math.max(...Object.values(referralTypes));
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-foreground-700">{status}</span>
                      <span className="text-[10px] font-medium text-foreground-500">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-background-100 overflow-hidden">
                      <div className={`h-full rounded-full ${
                        status.includes('Multi') ? 'bg-red-500' :
                        status.includes('External') && status.includes('Pending') ? 'bg-red-400' :
                        status.includes('Internal') ? 'bg-amber-400' :
                        status.includes('Complete') ? 'bg-emerald-400' :
                        'bg-foreground-300'
                      }`} style={{ width: `${(count / maxCount) * 100}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Case Summary Table */}
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Case Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Case Ref</th>
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Learner</th>
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Concern Type</th>
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Risk Level</th>
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Officer</th>
                  <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Reported</th>
                </tr>
              </thead>
              <tbody>
                {allCases.map(kase => (
                  <tr key={kase.id} className="border-b border-background-100/50">
                    <td className="px-3 py-2"><span className="font-mono text-[10px] text-red-500">{kase.caseRef}</span></td>
                    <td className="px-3 py-2 font-medium text-foreground-700">{kase.learnerName}</td>
                    <td className="px-3 py-2 text-[11px] text-foreground-600">{kase.concernType}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        kase.riskLevel === 'Immediate Action Required' ? 'bg-red-100 text-red-700' :
                        kase.riskLevel === 'High Risk' ? 'bg-red-50 text-red-700' :
                        kase.riskLevel === 'Medium Risk' ? 'bg-amber-50 text-amber-700' :
                        kase.riskLevel === 'Low Risk' ? 'bg-emerald-50 text-emerald-700' :
                        'bg-background-100 text-foreground-500'
                      }`}>{kase.riskLevel}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        kase.status === 'Immediate Action Required' ? 'bg-red-100 text-red-700' :
                        kase.status === 'High Risk' ? 'bg-red-50 text-red-700' :
                        kase.status === 'Closed' || kase.status === 'Archived' ? 'bg-emerald-50 text-emerald-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>{kase.status}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-foreground-500">{kase.safeguardingOfficerAssigned}</td>
                    <td className="px-3 py-2 text-[11px] text-foreground-400 whitespace-nowrap">{kase.dateReported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Export Actions */}
        <div className="flex items-center gap-3 justify-end">
          <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-download-2-line mr-1.5"></AppIcon> Export PDF
          </button>
          <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-file-excel-2-line mr-1.5"></AppIcon> Export CSV
          </button>
          <button className="px-4 py-2 bg-red-500 text-white rounded-xl text-[12px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-printer-line mr-1.5"></AppIcon> Print Report
          </button>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function ReportKpi({ label, value, sub, icon, colour }: { label: string; value: number; sub: string; icon: string; colour: string }) {
  const colourMap: Record<string, string> = {
    red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${colourMap[colour]} mb-2`}>
        <AppIcon className={`${icon} text-xs`}></AppIcon>
      </span>
      <p className="text-xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-1">{label}</p>
      <p className="text-[9px] text-foreground-300">{sub}</p>
    </div>
  );
}