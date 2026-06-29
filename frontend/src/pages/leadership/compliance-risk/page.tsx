import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const COMPLIANCE_RISKS = [
  { area: 'Onboarding Risk', level: 'high' as const, items: 2, detail: '2 learners with expired right-to-work evidence', impact: 'Funding at risk if not resolved within 14 days', owner: 'Enrolment Officer' },
  { area: 'Eligibility Risk', level: 'medium' as const, items: 1, detail: '1 learner with unconfirmed UK residency status', impact: 'Eligibility audit flag — requires documentation', owner: 'Enrolment Officer' },
  { area: 'Evidence Pack Risk', level: 'low' as const, items: 0, detail: 'All evidence packs verified and complete', impact: 'None — all packs compliant', owner: 'Enrolment Officer' },
  { area: 'Signature Risk', level: 'medium' as const, items: 1, detail: '1 employer declaration awaiting signature', impact: 'Cannot progress to active learning without signature', owner: 'Employer Engagement' },
  { area: 'DAS/ILR Risk', level: 'high' as const, items: 3, detail: '3 learners with DAS reservation not matching ILR programme aim', impact: 'ESFA funding audit risk — immediate resolution required', owner: 'MIS Operations' },
  { area: 'Funding Risk', level: 'medium' as const, items: 2, detail: '2 learners flagged for potential duplicate funding', impact: 'Could trigger ESFA clawback — investigation needed', owner: 'Finance' },
  { area: 'Audit Readiness', level: 'amber' as const, items: 4, detail: '4 files missing updated RPL documentation for current AY', impact: 'Would fail ESFA audit on sampling', owner: 'Quality Assurance' },
];

const AUDIT_TIMELINE = [
  { date: '15 Jun', event: 'ESFA funding audit window opens', status: 'upcoming' as const },
  { date: '28 Jun', event: 'Internal compliance review — Q2', status: 'upcoming' as const },
  { date: '12 Jul', event: 'Ofsted evidence pack finalisation deadline', status: 'upcoming' as const },
  { date: '01 Aug', event: 'DAS/ILR reconciliation deadline', status: 'upcoming' as const },
  { date: '15 Sep', event: 'Autumn term enrolment audit', status: 'upcoming' as const },
];

export default function ComplianceRiskPage() {
  const highRisk = COMPLIANCE_RISKS.filter(r => r.level === 'high').length;
  const totalItems = COMPLIANCE_RISKS.reduce((s, r) => s + r.items, 0);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Compliance Risk" pageSubtitle="Onboarding risk, eligibility risk, evidence pack risk, signatures risk, DAS/ILR risk, funding risk and audit readiness" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Compliance Risk Matrix" description={`${COMPLIANCE_RISKS.length} risk areas monitored · ${highRisk} high risk · ${totalItems} items requiring action`} icon="ri-shield-line" stats={[{ label: 'Risk Areas', value: String(COMPLIANCE_RISKS.length) }, { label: 'High Risk', value: String(highRisk) }, { label: 'Action Items', value: String(totalItems) }]} />

        {/* Risk Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {COMPLIANCE_RISKS.map(r => (
            <div key={r.area} className={`rounded-xl border p-4 ${r.level === 'high' ? 'border-red-200/70 bg-red-50/30' : r.level === 'medium' ? 'border-amber-200/70 bg-amber-50/20' : r.level === 'amber' ? 'border-amber-200/50 bg-amber-50/10' : 'border-emerald-200/60 bg-emerald-50/20'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-foreground-800">{r.area}</span>
                <span className={`w-2.5 h-2.5 rounded-full ${r.level === 'high' ? 'bg-red-500' : r.level === 'medium' ? 'bg-amber-500' : r.level === 'amber' ? 'bg-amber-400' : 'bg-emerald-500'}`}></span>
              </div>
              <p className={`text-2xl font-heading font-bold ${r.level === 'high' ? 'text-red-700' : r.level === 'medium' ? 'text-amber-700' : r.level === 'amber' ? 'text-amber-600' : 'text-emerald-700'}`}>{r.items}</p>
              <p className="text-[10px] text-foreground-600 leading-tight mt-1 mb-2">{r.detail}</p>
              <div className="border-t border-black/5 pt-2 space-y-1">
                <p className="text-[9px] text-foreground-500"><span className="font-medium">Impact:</span> {r.impact}</p>
                <p className="text-[9px] text-foreground-400"><span className="font-medium">Owner:</span> {r.owner}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Overall Risk Summary */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Overall Compliance Risk Profile</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { l: 'High Risk', v: highRisk, color: 'bg-red-500', desc: 'Immediate action required — funding at risk' },
              { l: 'Medium/Amber Risk', v: COMPLIANCE_RISKS.filter(r => r.level === 'medium' || r.level === 'amber').length, color: 'bg-amber-500', desc: 'Requires attention within 30 days' },
              { l: 'Low/Compliant', v: COMPLIANCE_RISKS.filter(r => r.level === 'low').length, color: 'bg-emerald-500', desc: 'No immediate action required' },
            ].map(s => (
              <div key={s.l} className="flex items-center gap-3 p-3 rounded-lg border border-foreground-200">
                <span className={`w-10 h-10 rounded-lg ${s.color} flex items-center justify-center shrink-0`}><span className="text-white text-lg font-bold">{s.v}</span></span>
                <div>
                  <p className="text-[11px] font-semibold text-foreground-900">{s.l}</p>
                  <p className="text-[9px] text-foreground-400">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Audit Timeline */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Upcoming Compliance Events</h3>
          <div className="space-y-2">
            {AUDIT_TIMELINE.map((e, i) => (
              <div key={e.date} className="flex items-center gap-3 p-3 rounded-lg border border-foreground-200">
                <span className="text-[11px] font-bold text-foreground-700 w-16 shrink-0">{e.date}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${e.status === 'upcoming' ? 'bg-accent-500' : 'bg-emerald-500'}`}></span>
                <span className="text-[11px] text-foreground-600">{e.event}</span>
                {i < AUDIT_TIMELINE.length - 1 && <div className="absolute left-[3.4rem] top-7 w-0.5 h-6 bg-background-200 ml-0.5 hidden sm:block"></div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}