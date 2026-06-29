import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const OTJH_MONTHLY = [
  { month: 'Jan', planned: 68, claimed: 65, validated: 60, rejected: 8, pending: 5 },
  { month: 'Feb', planned: 72, claimed: 69, validated: 65, rejected: 7, pending: 4 },
  { month: 'Mar', planned: 75, claimed: 72, validated: 70, rejected: 5, pending: 2 },
  { month: 'Apr', planned: 80, claimed: 77, validated: 74, rejected: 6, pending: 3 },
  { month: 'May', planned: 85, claimed: 82, validated: 79, rejected: 6, pending: 3 },
  { month: 'Jun', planned: 88, claimed: 86, validated: 82, rejected: 4, pending: 4 },
];

const OTJH_BY_COHORT = [
  { cohort: 'SD-L4 Sep 2024', planned: 100, claimed: 100, validated: 100, rejected: 0, pending: 0, risk: 'low' as const },
  { cohort: 'OM-L5 Jan 2025', planned: 100, claimed: 98, validated: 98, rejected: 0, pending: 2, risk: 'low' as const },
  { cohort: 'BA-L3 June 2026', planned: 100, claimed: 16, validated: 14, rejected: 2, pending: 0, risk: 'medium' as const },
  { cohort: 'HR-L5 March 2025', planned: 100, claimed: 74, validated: 72, rejected: 8, pending: 2, risk: 'medium' as const },
  { cohort: 'ME-L4 May 2026', planned: 100, claimed: 62, validated: 58, rejected: 6, pending: 4, risk: 'medium' as const },
  { cohort: 'PM-L4 Feb 2026', planned: 100, claimed: 20, validated: 18, rejected: 4, pending: 2, risk: 'high' as const },
  { cohort: 'DA-L4 April 2026', planned: 0, claimed: 0, validated: 0, rejected: 0, pending: 0, risk: 'high' as const },
];

export default function OtjhTrendsPage() {
  const totalPlanned = OTJH_BY_COHORT.filter(c => c.planned > 0).reduce((s, c) => s + 100, 0);
  const avgValidated = Math.round(OTJH_BY_COHORT.filter(c => c.planned > 0).reduce((s, c) => s + c.validated, 0) / OTJH_BY_COHORT.filter(c => c.planned > 0).length);
  const totalRejected = OTJH_BY_COHORT.reduce((s, c) => s + c.rejected, 0);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="OTJH Trends" pageSubtitle="Planned OTJH vs claimed vs validated — rejection rates and pending OTJH by cohort and programme" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="OTJH Trends" description={`Avg validated ${avgValidated}% · ${totalRejected} rejected entries · Real-time OTJH intelligence`} icon="ri-time-line" stats={[{ label: 'Avg Validated', value: `${avgValidated}%` }, { label: 'Total Rejected', value: String(totalRejected) }, { label: 'Cohorts Tracked', value: String(OTJH_BY_COHORT.length) }]} />

        {/* Monthly OTJH Chart */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">OTJH — Planned vs Claimed vs Validated (6 Month)</h3>
          <div className="relative h-52">
            <div className="absolute inset-0 flex items-end justify-between px-1">
              {OTJH_MONTHLY.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group">
                  <div className="flex gap-[2px] items-end">
                    <div className="w-[6px] bg-secondary-300/70 rounded-t-sm" style={{ height: `${m.planned * 1.5}px` }}></div>
                    <div className="w-[6px] bg-amber-400/70 rounded-t-sm" style={{ height: `${m.claimed * 1.5}px` }}></div>
                    <div className="w-[6px] bg-emerald-500/80 rounded-t-sm" style={{ height: `${m.validated * 1.5}px` }}></div>
                    <div className="w-[6px] bg-red-400/70 rounded-t-sm" style={{ height: `${m.rejected * 6}px` }}></div>
                  </div>
                  <span className="text-[7px] text-foreground-400 mt-1">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-5 mt-3 text-[10px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-secondary-300/70"></span> Planned</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/70"></span> Claimed</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80"></span> Validated</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400/70"></span> Rejected</span>
          </div>
        </div>

        {/* Cohort OTJH Table */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">OTJH by Cohort</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">Cohort</th>
                  <th className="text-center py-2.5">Planned</th>
                  <th className="text-center py-2.5">Claimed</th>
                  <th className="text-center py-2.5">Validated</th>
                  <th className="text-center py-2.5">Rejected</th>
                  <th className="text-center py-2.5">Pending</th>
                  <th className="text-center py-2.5">Risk</th>
                  <th className="text-center py-2.5">Gap</th>
                </tr>
              </thead>
              <tbody>
                {OTJH_BY_COHORT.map(c => {
                  const gap = c.planned > 0 ? c.planned - c.validated : 100;
                  return (
                    <tr key={c.cohort} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                      <td className="py-2.5 px-4 font-medium text-foreground-700">{c.cohort}</td>
                      <td className="text-center text-foreground-600">{c.planned > 0 ? `${c.planned}%` : '—'}</td>
                      <td className="text-center text-foreground-600">{c.planned > 0 ? `${c.claimed}%` : '—'}</td>
                      <td className={`text-center font-semibold ${c.validated >= 80 ? 'text-emerald-600' : c.validated >= 50 ? 'text-amber-600' : c.validated > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{c.planned > 0 ? `${c.validated}%` : '—'}</td>
                      <td className={`text-center font-semibold ${c.rejected > 5 ? 'text-red-600' : c.rejected > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{c.rejected}</td>
                      <td className={`text-center font-medium ${c.pending > 2 ? 'text-amber-600' : 'text-emerald-600'}`}>{c.pending}</td>
                      <td className="text-center"><span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.risk === 'high' ? 'bg-red-100 text-red-700' : c.risk === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{c.risk}</span></td>
                      <td className="text-center">
                        <span className={`font-semibold ${gap <= 10 ? 'text-emerald-600' : gap <= 30 ? 'text-amber-600' : 'text-red-600'}`}>{c.planned > 0 ? `${gap}%` : '100%'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}