import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const GATEWAY_EPA_LEARNERS = [
  { learner: 'Amina Yusuf', programme: 'Ops Manager L5', cohort: 'OM-L5 Jan 2025', gatewayReadiness: 88, gatewayEstimate: 'Jul 2026', epaEstimate: 'Sep 2026', ksbCompletion: 96, otjhCompletion: 98, status: 'gateway-ready' as const, epaOrganisation: 'NOCN', result: null as string | null },
  { learner: 'Kwame Boateng', programme: 'Ops Manager L5', cohort: 'OM-L5 Jan 2025', gatewayReadiness: 88, gatewayEstimate: 'Jul 2026', epaEstimate: 'Sep 2026', ksbCompletion: 94, otjhCompletion: 98, status: 'gateway-ready' as const, epaOrganisation: 'NOCN', result: null },
  { learner: 'Priya Sharma', programme: 'Software Dev L4', cohort: 'SD-L4 Sep 2024', gatewayReadiness: 100, gatewayEstimate: 'Mar 2026', epaEstimate: 'May 2026', ksbCompletion: 100, otjhCompletion: 100, status: 'epa-active' as const, epaOrganisation: 'BCS', result: 'In progress' },
  { learner: 'Omar Hassan', programme: 'Software Dev L4', cohort: 'SD-L4 Sep 2024', gatewayReadiness: 100, gatewayEstimate: 'Mar 2026', epaEstimate: 'May 2026', ksbCompletion: 100, otjhCompletion: 100, status: 'epa-active' as const, epaOrganisation: 'BCS', result: 'In progress' },
  { learner: 'Jasmine Clarke', programme: 'HR Consultant L5', cohort: 'HR-L5 March 2025', gatewayReadiness: 64, gatewayEstimate: 'Sep 2026', epaEstimate: 'Nov 2026', ksbCompletion: 68, otjhCompletion: 74, status: 'approaching' as const, epaOrganisation: 'CIPD', result: null },
  { learner: 'Liam O\'Connor', programme: 'HR Consultant L5', cohort: 'HR-L5 March 2025', gatewayReadiness: 60, gatewayEstimate: 'Sep 2026', epaEstimate: 'Nov 2026', ksbCompletion: 65, otjhCompletion: 72, status: 'approaching' as const, epaOrganisation: 'CIPD', result: null },
  { learner: 'Elena Rodriguez', programme: 'Business Admin L3', cohort: 'BA-L3 June 2026', gatewayReadiness: 8, gatewayEstimate: 'Dec 2027', epaEstimate: 'Feb 2028', ksbCompletion: 11, otjhCompletion: 14, status: 'learning' as const, epaOrganisation: 'NCFE', result: null },
  { learner: 'Tom Harrington', programme: 'Business Admin L3', cohort: 'BA-L3 June 2026', gatewayReadiness: 10, gatewayEstimate: 'Dec 2027', epaEstimate: 'Feb 2028', ksbCompletion: 13, otjhCompletion: 16, status: 'learning' as const, epaOrganisation: 'NCFE', result: null },
];

const EPA_RESULTS = [
  { programme: 'Ops Manager L5', totalCompleted: 2, distinctions: 1, merits: 1, passes: 0, referrals: 0, achievementRate: 100 },
  { programme: 'Software Dev L4', totalCompleted: 2, distinctions: 0, merits: 0, passes: 2, referrals: 0, achievementRate: 100, note: 'In progress — results pending' },
  { programme: 'HR Consultant L5', totalCompleted: 0, distinctions: 0, merits: 0, passes: 0, referrals: 0, achievementRate: 0 },
  { programme: 'Business Admin L3', totalCompleted: 0, distinctions: 0, merits: 0, passes: 0, referrals: 0, achievementRate: 0 },
];

export default function GatewayEpaProgressPage() {
  const gatewayReady = GATEWAY_EPA_LEARNERS.filter(l => l.status === 'gateway-ready').length;
  const epaActive = GATEWAY_EPA_LEARNERS.filter(l => l.status === 'epa-active').length;
  const approaching = GATEWAY_EPA_LEARNERS.filter(l => l.status === 'approaching').length;

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Gateway & EPA Progress" pageSubtitle="Gateway readiness, EPA preparation, bookings, result status, achievements, resits and retakes" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Gateway & EPA Progress" description={`${gatewayReady} gateway-ready · ${epaActive} in EPA · ${approaching} approaching gateway`} icon="ri-flag-line" stats={[{ label: 'Gateway Ready', value: String(gatewayReady) }, { label: 'EPA Active', value: String(epaActive) }, { label: 'Approaching', value: String(approaching) }]} />

        {/* Learner Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {GATEWAY_EPA_LEARNERS.map(l => (
            <div key={l.learner} className={`bg-background-50 rounded-xl border p-5 ${l.status === 'epa-active' ? 'border-emerald-200/60' : l.status === 'gateway-ready' ? 'border-amber-200/60' : l.status === 'approaching' ? 'border-primary-200/50' : 'border-foreground-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{l.learner}</h3>
                  <p className="text-[10px] text-foreground-400">{l.programme} · {l.cohort}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${l.status === 'epa-active' ? 'bg-emerald-100 text-emerald-700' : l.status === 'gateway-ready' ? 'bg-amber-100 text-amber-700' : l.status === 'approaching' ? 'bg-primary-100 text-primary-700' : 'bg-background-200 text-foreground-500'}`}>
                  {l.status === 'epa-active' ? 'EPA ACTIVE' : l.status === 'gateway-ready' ? 'GATEWAY READY' : l.status === 'approaching' ? 'APPROACHING' : 'LEARNING'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {[
                  { l: 'Gateway Readiness', v: `${l.gatewayReadiness}%` },
                  { l: 'KSB Completion', v: `${l.ksbCompletion}%` },
                  { l: 'OTJH Completion', v: `${l.otjhCompletion}%` },
                  { l: 'Result', v: l.result || '—' },
                ].map(m => (
                  <div key={m.l} className="bg-background-100/60 rounded-lg p-2 text-center">
                    <p className="text-[13px] font-bold text-foreground-900">{m.v}</p>
                    <p className="text-[8px] text-foreground-400">{m.l}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-foreground-500">
                <span>Gateway: {l.gatewayEstimate}</span>
                <span>·</span>
                <span>EPA: {l.epaEstimate}</span>
                <span>·</span>
                <span>Organisation: {l.epaOrganisation}</span>
              </div>
              <div className="mt-2 w-full bg-background-200 rounded-full h-2">
                <div className={`h-2 rounded-full ${l.gatewayReadiness >= 80 ? 'bg-emerald-500' : l.gatewayReadiness >= 50 ? 'bg-amber-500' : 'bg-accent-500'}`} style={{ width: `${l.gatewayReadiness}%` }}></div>
              </div>
            </div>
          ))}
        </div>

        {/* EPA Results Summary */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">EPA Results by Programme</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">Programme</th>
                  <th className="text-center py-2.5">Completed</th>
                  <th className="text-center py-2.5">Distinction</th>
                  <th className="text-center py-2.5">Merit</th>
                  <th className="text-center py-2.5">Pass</th>
                  <th className="text-center py-2.5">Referral</th>
                  <th className="text-center py-2.5">Achievement Rate</th>
                  <th className="text-center py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {EPA_RESULTS.map(r => (
                  <tr key={r.programme} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2.5 px-4 font-medium text-foreground-700">{r.programme}</td>
                    <td className="text-center font-semibold text-foreground-900">{r.totalCompleted}</td>
                    <td className="text-center text-emerald-600 font-medium">{r.distinctions}</td>
                    <td className="text-center text-amber-600 font-medium">{r.merits}</td>
                    <td className="text-center text-primary-600 font-medium">{r.passes}</td>
                    <td className={`text-center font-medium ${r.referrals > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{r.referrals}</td>
                    <td className="text-center"><span className={`text-[11px] font-bold ${r.achievementRate >= 80 ? 'text-emerald-600' : r.achievementRate > 0 ? 'text-amber-600' : 'text-foreground-300'}`}>{r.achievementRate > 0 ? `${r.achievementRate}%` : '—'}</span></td>
                    <td className="text-center text-[10px] text-foreground-400">{r.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}