import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { INTERNAL_ESCALATIONS, EXTERNAL_REFERRALS, SAFEGUARDING_CASES } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const TABS = ['Internal Escalations', 'External Referrals', 'Employer Concerns', 'Emergency Actions'] as const;

const employerConcerns = SAFEGUARDING_CASES.filter(c =>
  c.concernType === 'Employer/Workplace Concern' || c.concernType === 'Concern Raised by Employer'
);

export default function ReferralsPage() {
  const [activeTab, setActiveTab] = useState<string>('Internal Escalations');

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Referrals & Escalations" pageSubtitle="Internal and external referral management"
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Internal Escalations' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4">
              <p className="text-[12px] text-amber-800">
                <i className="ri-information-line mr-1"></i>
                Internal escalations track when concerns are raised by one team and escalated to Safeguarding. All escalations must be acknowledged within 4 hours.
              </p>
            </div>
            <div className="overflow-x-auto bg-background-50 rounded-xl border border-foreground-200/60">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-foreground-400/50">
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">From → To</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Case</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Reason</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {INTERNAL_ESCALATIONS.map(esc => (
                    <tr key={esc.id} className="border-b border-background-100/50 hover:bg-red-50/20 transition-smooth">
                      <td className="px-4 py-2.5">
                        <span className="text-foreground-600">{esc.from}</span>
                        <i className="ri-arrow-right-line text-[10px] mx-1.5 text-red-400"></i>
                        <span className="text-red-600 font-medium">{esc.to}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-mono text-red-500">{esc.caseRef}</span>
                        <span className="text-[11px] text-foreground-600 ml-1.5">{esc.learner}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-foreground-600 max-w-[280px]">{esc.reason}</td>
                      <td className="px-4 py-2.5 text-foreground-400 whitespace-nowrap">{esc.date}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          esc.status === 'Accepted' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>{esc.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'External Referrals' && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200/60 rounded-xl p-4">
              <p className="text-[12px] text-red-800">
                <i className="ri-error-warning-line mr-1"></i>
                External referrals involve statutory agencies and external organisations. All external referrals must be authorised by DSL.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {EXTERNAL_REFERRALS.map(ref => (
                <div key={ref.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        ref.type === 'MARAC' ? 'bg-red-100 text-red-600' :
                        ref.type === 'Police' ? 'bg-red-100 text-red-600' :
                        ref.type === 'Prevent/Channel' ? 'bg-amber-100 text-amber-600' :
                        ref.type === 'LADO' ? 'bg-red-100 text-red-600' :
                        'bg-secondary-100 text-secondary-600'
                      }`}>
                        <i className={`${ref.type === 'MARAC' ? 'ri-alert-line' : ref.type === 'Police' ? 'ri-police-car-line' : ref.type === 'Prevent/Channel' ? 'ri-radar-line' : ref.type === 'LADO' ? 'ri-shield-user-line' : 'ri-building-line'} text-xs`}></i>
                      </div>
                      <div>
                        <p className="text-[12px] font-semibold text-foreground-800">{ref.type}</p>
                        <p className="text-[10px] text-foreground-400">{ref.organisation}</p>
                      </div>
                    </div>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                      ref.status === 'Active' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                    }`}>{ref.status}</span>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    <p><span className="text-foreground-400">Case:</span> <span className="font-mono text-red-500">{ref.caseRef}</span></p>
                    <p><span className="text-foreground-400">Date:</span> <span className="text-foreground-600">{ref.date}</span></p>
                    <p><span className="text-foreground-400">Outcome:</span> <span className="text-foreground-600">{ref.outcome}</span></p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Employer Concerns' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              Concerns raised by or about employers. These include workplace safety issues, employer-reported welfare concerns, and discrimination cases.
            </p>
            {employerConcerns.map(kase => (
              <div key={kase.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className="ri-building-2-line text-secondary-600 text-lg"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-800">{kase.learnerName} — {kase.employer}</p>
                    <p className="text-[11px] text-foreground-500 mt-1">{kase.concernSummary}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-foreground-400">
                      <span className="font-mono text-red-500">{kase.caseRef}</span>
                      <span>·</span>
                      <span>{kase.concernType}</span>
                      <span>·</span>
                      <span className={kase.riskLevel === 'Medium Risk' ? 'text-amber-600' : 'text-emerald-600'}>{kase.riskLevel}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Emergency Actions' && (
          <div className="space-y-3">
            <div className="bg-red-500 rounded-xl p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <i className="ri-alarm-warning-line text-2xl"></i>
                </div>
                <div>
                  <p className="text-base font-heading font-bold">Emergency Actions Protocol</p>
                  <p className="text-[12px] text-white/80 mt-1">For cases requiring immediate intervention — police, emergency services, or urgent multi-agency response.</p>
                </div>
              </div>
            </div>
            {SAFEGUARDING_CASES.filter(c => c.riskLevel === 'Immediate Action Required').filter(c => c.status !== 'Closed' && c.status !== 'Archived').map(kase => (
              <div key={kase.id} className="bg-background-50 rounded-xl border-2 border-red-300 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center shrink-0">
                    <i className="ri-alarm-warning-line text-white text-lg"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-heading font-semibold text-red-900">{kase.caseRef} — {kase.learnerName}</p>
                    <p className="text-[12px] text-red-700 mt-1">{kase.concernType}</p>
                    <p className="text-[11px] text-red-600 mt-2">{kase.immediateActionDetail}</p>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] text-red-500">{kase.referralHistory.map(r => r.type).join(' · ')}</span>
                      <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 cursor-pointer whitespace-nowrap ml-auto">
                        Emergency Contact
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}