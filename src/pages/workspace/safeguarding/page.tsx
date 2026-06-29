import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  SAFEGUARDING_CASES,
  DASHBOARD_STATS,
  VULNERABLE_LEARNERS,
  INTERNAL_ESCALATIONS,
  EXTERNAL_REFERRALS,
  PREVENT_CONCERNS,
  SAFEGUARDING_MESSAGES,
  SAFEGUARDING_AUDIT,
} from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

export default function SafeguardingDashboard() {
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [showRestrictedBanner, setShowRestrictedBanner] = useState(true);

  const openCases = SAFEGUARDING_CASES.filter(c => c.status !== 'Closed' && c.status !== 'Archived');
  const highRiskCases = SAFEGUARDING_CASES.filter(c => c.riskLevel === 'High Risk' || c.riskLevel === 'Immediate Action Required');
  const newConcerns = SAFEGUARDING_CASES.filter(c => c.status === 'New Concern' || c.riskLevel === 'New Concern');
  const overdueFollowUps = SAFEGUARDING_CASES.flatMap(c => c.followUpActions.filter(f => f.status === 'Overdue'));
  const dslReviewCases = SAFEGUARDING_CASES.filter(c => c.dslReviewRequired && c.dslReviewStatus === 'Pending');
  const closedAwaitingAudit = SAFEGUARDING_CASES.filter(c => c.status === 'Closed' && !c.caseClosureReason);

  return (
    <WorkspaceShell
      role="safeguarding"
      roleLabel={sgConfig.label}
      navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Safeguarding Workspace"
      pageSubtitle="Restricted Access — Designated Safeguarding Lead | All activity is logged and audited"
      userName="Dr. Eleanor Vance"
      userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Restricted Access Banner */}
        {showRestrictedBanner && (
          <div className="bg-red-50/80 border border-red-200/60 rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <i className="ri-shield-keyhole-line text-red-600 text-lg"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-heading font-semibold text-red-900">Restricted Workspace — Safeguarding</p>
              <p className="text-[12px] text-red-700 mt-1">
                This workspace contains sensitive and confidential safeguarding information. Access is restricted to DSL, Deputy DSL, Safeguarding Officers, and authorised senior leaders. All access is logged and auditable. You must not share or discuss case details outside authorised channels.
              </p>
            </div>
            <button
              onClick={() => setShowRestrictedBanner(false)}
              className="text-red-400 hover:text-red-600 transition-smooth cursor-pointer shrink-0"
            >
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
        )}

        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative h-full flex flex-col justify-center px-6 md:px-8">
            <div className="flex items-center gap-3 mb-1.5">
              <h2 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight">Safeguarding Command Centre</h2>
              <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 shrink-0 whitespace-nowrap">RESTRICTED ACCESS</span>
            </div>
            <p className="text-[13px] text-white/50">
              {DASHBOARD_STATS.totalActiveCases} active cases &middot; {DASHBOARD_STATS.highRiskCases} high-risk &middot; {DASHBOARD_STATS.externalReferrals} external referrals
            </p>
          </div>
        </div>

        {/* Critical Alert — Immediate Action Required */}
        {highRiskCases.some(c => c.status === 'Immediate Action Required') && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 flex flex-col sm:flex-row items-start gap-3 animate-pulse-slow">
            <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center shrink-0">
              <i className="ri-alarm-warning-line text-white text-lg"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-heading font-bold text-red-900">
                Immediate Action Required — {highRiskCases.filter(c => c.status === 'Immediate Action Required').length} active case(s)
              </p>
              <div className="mt-2 space-y-1">
                {highRiskCases.filter(c => c.status === 'Immediate Action Required').map(c => (
                  <a key={c.id} href={`/safeguarding/high-risk-cases`} className="block text-[12px] text-red-800 font-medium hover:text-red-950 cursor-pointer">
                    <i className="ri-arrow-right-s-line text-[10px] mr-1"></i>
                    {c.caseRef} — {c.learnerName} — {c.concernType} — <span className="font-semibold">{c.safeguardingOfficerAssigned}</span>
                  </a>
                ))}
              </div>
            </div>
            <a href="/safeguarding/high-risk-cases" className="px-4 py-2 bg-red-500 text-white rounded-lg text-[12px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
              View Cases <i className="ri-arrow-right-line ml-1"></i>
            </a>
          </div>
        )}

        {/* KPI Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="New Concerns" value={DASHBOARD_STATS.newConcernsAwaitingReview} sub="awaiting review" icon="ri-alert-line" colour="red" />
          <StatCard label="Open Cases" value={DASHBOARD_STATS.openSafeguardingCases} sub="active" icon="ri-folder-open-line" colour="amber" />
          <StatCard label="High-Risk" value={DASHBOARD_STATS.highRiskCases + DASHBOARD_STATS.immediateActionRequired} sub="needs attention" icon="ri-error-warning-line" colour="red" />
          <StatCard label="Overdue Actions" value={DASHBOARD_STATS.overdueFollowUpActions} sub="follow-ups" icon="ri-timer-line" colour="amber" />
          <StatCard label="DSL Reviews" value={DASHBOARD_STATS.casesRequiringDSLReview} sub="pending" icon="ri-file-search-line" colour="red" />
          <StatCard label="Vulnerable Learners" value={DASHBOARD_STATS.vulnerableLearnersMonitoring} sub="monitoring" icon="ri-user-heart-line" colour="amber" />
        </div>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left 2/3 — Cases and Escalations */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Active Cases Panel */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">
                  Active Safeguarding Cases
                  <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200/50">RESTRICTED</span>
                </h3>
                <a href="/safeguarding/open-cases" className="text-[11px] text-red-600 hover:text-red-700 font-medium whitespace-nowrap cursor-pointer">
                  All Cases <i className="ri-arrow-right-line text-[10px] ml-0.5"></i>
                </a>
              </div>
              <div className="space-y-2">
                {openCases.slice(0, 6).map(kase => (
                  <a key={kase.id} href="/safeguarding/open-cases" className="block bg-background-50 rounded-xl border border-background-200/40 p-3 hover:border-red-200/40 transition-smooth cursor-pointer group">
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        kase.riskLevel === 'Immediate Action Required' ? 'bg-red-500 animate-pulse' :
                        kase.riskLevel === 'High Risk' ? 'bg-red-400' :
                        kase.riskLevel === 'Medium Risk' ? 'bg-amber-400' :
                        'bg-emerald-400'
                      }`}></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-foreground-800">{kase.learnerName}</p>
                            <p className="text-[11px] text-foreground-500 mt-0.5 line-clamp-2">{kase.concernSummary}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                              kase.riskLevel === 'Immediate Action Required' ? 'bg-red-100 text-red-700 border border-red-200' :
                              kase.riskLevel === 'High Risk' ? 'bg-red-50 text-red-700 border border-red-200/50' :
                              kase.riskLevel === 'Medium Risk' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                              'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                            }`}>{kase.riskLevel}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[10px] font-mono text-foreground-400">{kase.caseRef}</span>
                          <span className="text-[10px] text-foreground-300">·</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600">{kase.concernType}</span>
                          <span className="text-[10px] text-foreground-300">·</span>
                          <span className="text-[10px] text-foreground-400">{kase.programme}</span>
                          <span className="text-[10px] text-foreground-300">·</span>
                          <span className="text-[10px] text-foreground-400">{kase.safeguardingOfficerAssigned}</span>
                          <span className="text-[10px] text-foreground-300 ml-auto">{kase.dateReported}</span>
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </section>

            {/* Internal Escalations */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Recent Escalations</h3>
                <a href="/safeguarding/referrals" className="text-[11px] text-red-600 hover:text-red-700 font-medium whitespace-nowrap cursor-pointer">
                  View All <i className="ri-arrow-right-line text-[10px] ml-0.5"></i>
                </a>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-foreground-400/50">
                      <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">From</th>
                      <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">To</th>
                      <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Case</th>
                      <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Reason</th>
                      <th className="text-left px-3 py-2 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INTERNAL_ESCALATIONS.map(esc => (
                      <tr key={esc.id} className="border-b border-background-100/50 hover:bg-red-50/30 transition-smooth cursor-pointer">
                        <td className="px-3 py-2 text-foreground-600">{esc.from}</td>
                        <td className="px-3 py-2 text-foreground-600">{esc.to}</td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] font-mono text-red-600">{esc.caseRef}</span>
                          <span className="text-[10px] text-foreground-400 ml-1">— {esc.learner}</span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-foreground-600 max-w-[220px] truncate">{esc.reason}</td>
                        <td className="px-3 py-2 text-foreground-400 whitespace-nowrap">{esc.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right 1/3 */}
          <div className="space-y-4 md:space-y-6">
            {/* Vulnerable Learners */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Vulnerable Learners</h3>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200/50">MONITORING</span>
              </div>
              <div className="space-y-2.5">
                {VULNERABLE_LEARNERS.map(vl => (
                  <div key={vl.name} className="flex items-start gap-2.5 py-2 border-b border-background-100/50 last:border-0">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      vl.risk.includes('Immediate') ? 'bg-red-500' :
                      vl.risk === 'High Risk' ? 'bg-red-400' :
                      'bg-amber-400'
                    }`}></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-foreground-800">{vl.name}</p>
                      <p className="text-[10px] text-foreground-400">{vl.programme}</p>
                      <p className="text-[10px] text-red-600 font-medium mt-0.5">{vl.concern}</p>
                      <p className="text-[9px] text-foreground-300 mt-0.5">{vl.officer}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* External Referrals Summary */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">External Referrals</h3>
                <a href="/safeguarding/referrals" className="text-[11px] text-red-600 hover:text-red-700 font-medium whitespace-nowrap cursor-pointer">
                  Details <i className="ri-external-link-line text-[10px] ml-0.5"></i>
                </a>
              </div>
              <div className="space-y-2.5">
                {EXTERNAL_REFERRALS.slice(0, 6).map(ref => (
                  <div key={ref.id} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      ref.status === 'Active' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      <i className={`${ref.type === 'MARAC' ? 'ri-alert-line' : ref.type === 'Police' ? 'ri-police-car-line' : ref.type === 'Prevent/Channel' ? 'ri-radar-line' : ref.type === 'Social Care' ? 'ri-user-heart-line' : ref.type === 'LADO' ? 'ri-shield-user-line' : 'ri-building-line'} text-xs`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-foreground-700">{ref.type} — {ref.organisation}</p>
                      <p className="text-[9px] text-foreground-400">{ref.caseRef} · {ref.date} · {ref.outcome}</p>
                    </div>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                      ref.status === 'Active' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                    }`}>{ref.status}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Prevent Concerns */}
            {PREVENT_CONCERNS.length > 0 && (
              <section className="bg-amber-50/80 rounded-xl border border-amber-200/50 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-amber-900">Prevent Concerns</h3>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">STATUTORY DUTY</span>
                </div>
                {PREVENT_CONCERNS.map(pc => (
                  <div key={pc.id} className="bg-white/60 rounded-lg p-3">
                    <p className="text-[12px] font-semibold text-amber-900">{pc.learner}</p>
                    <p className="text-[10px] text-amber-700 mt-1">Channel Ref: {pc.channelRef}</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">{pc.status} · Officer: {pc.officer}</p>
                    <p className="text-[10px] text-amber-500 mt-1">Reported: {pc.date}</p>
                  </div>
                ))}
              </section>
            )}

            {/* Messages */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Team Messages</h3>
                <a href="/safeguarding/communication" className="text-[11px] text-red-600 hover:text-red-700 font-medium whitespace-nowrap cursor-pointer">
                  Inbox <i className="ri-arrow-right-line text-[10px] ml-0.5"></i>
                </a>
              </div>
              <div className="space-y-2">
                {SAFEGUARDING_MESSAGES.slice(0, 4).map(msg => (
                  <div key={msg.id} className={`flex items-start gap-2.5 py-1.5 ${!msg.read ? 'bg-amber-50/50 -mx-2 px-2 rounded-lg' : ''}`}>
                    {!msg.read && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-foreground-800">{msg.subject}</p>
                      <p className="text-[10px] text-foreground-500">{msg.from} · {msg.date}</p>
                    </div>
                    {msg.priority === 'High' && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 shrink-0">HIGH</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Bottom Row — Audit + Case Type Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* Safeguarding Audit Summary */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Safeguarding Audit Trail</h3>
              <a href="/safeguarding/qa-audit" className="text-[11px] text-red-600 hover:text-red-700 font-medium whitespace-nowrap cursor-pointer">
                Full Audit <i className="ri-arrow-right-line text-[10px] ml-0.5"></i>
              </a>
            </div>
            <div className="space-y-3">
              {SAFEGUARDING_AUDIT.map(audit => (
                <div key={audit.id} className="flex items-start gap-3 py-2 border-b border-background-100/50 last:border-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    audit.rating === 'Outstanding' ? 'bg-emerald-100 text-emerald-600' : 'bg-secondary-100 text-secondary-600'
                  }`}>
                    <i className="ri-check-double-line text-xs"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground-800">{audit.type} — {audit.date}</p>
                    <p className="text-[10px] text-foreground-500">{audit.auditor} · {audit.casesReviewed} cases reviewed</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5">{audit.findings}</p>
                  </div>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ${
                    audit.rating === 'Outstanding' ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary-50 text-secondary-700'
                  }`}>{audit.rating}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Concern Type Distribution */}
          <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Concern Type Distribution</h3>
            <div className="space-y-3">
              {(() => {
                const typeCounts: Record<string, number> = {};
                SAFEGUARDING_CASES.forEach(c => {
                  typeCounts[c.concernType] = (typeCounts[c.concernType] || 0) + 1;
                });
                const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
                const maxCount = sorted[0]?.[1] || 1;
                const colors = ['bg-red-400', 'bg-red-300', 'bg-amber-400', 'bg-orange-400', 'bg-red-350', 'bg-amber-300', 'bg-secondary-400', 'bg-orange-300'];
                return sorted.map(([type, count], idx) => (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-foreground-700">{type}</span>
                      <span className="text-[10px] font-medium text-foreground-500">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background-100 overflow-hidden">
                      <div className={`h-full rounded-full ${colors[idx] || 'bg-foreground-300'}`} style={{ width: `${(count / maxCount) * 100}%` }}></div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </section>
        </div>

        {/* Footer — Confidentiality Notice */}
        <div className="bg-background-50 rounded-xl border border-red-200/30 p-3 md:p-4 text-center">
          <p className="text-[10px] text-foreground-300">
            <i className="ri-lock-line mr-1"></i>
            This workspace and all contained information is CONFIDENTIAL and subject to restricted access controls under the Safeguarding Policy v4.2.
            Unauthorised access or disclosure is a serious disciplinary matter. All activity is logged and auditable.
          </p>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function HeroKpiCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className={`flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-black/30 backdrop-blur-md border border-white/10`}>
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
        <i className={`${icon} text-sm ${color === 'red' ? 'text-red-300' : 'text-amber-300'}`}></i>
      </div>
      <div>
        <p className="text-[9px] md:text-[10px] text-white/50 font-medium uppercase tracking-wider">{label}</p>
        <p className={`text-lg md:text-xl font-heading font-bold ${color === 'red' ? 'text-red-300' : 'text-amber-300'}`}>{value}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, colour }: { label: string; value: number; sub: string; icon: string; colour: string }) {
  const colourMap: Record<string, string> = {
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
      <span className={`w-7 md:w-8 h-7 md:h-8 rounded-lg flex items-center justify-center ${colourMap[colour]} mb-2 md:mb-3`}>
        <i className={`${icon} text-xs md:text-sm`}></i>
      </span>
      <p className="text-xl md:text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] md:text-[11px] text-foreground-400 mt-1">{label}</p>
      <p className="text-[10px] text-foreground-300">{sub}</p>
    </div>
  );
}