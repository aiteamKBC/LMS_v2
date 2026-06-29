import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SAFEGUARDING_CASES, VULNERABLE_LEARNERS } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const TABS = ['Wellbeing Concerns', 'Support Needs', 'Vulnerable Learners', 'Follow-up Actions'] as const;

const allFollowUps = SAFEGUARDING_CASES
  .filter(c => c.status !== 'Closed' && c.status !== 'Archived')
  .flatMap(c => c.followUpActions.filter(f => f.status !== 'Completed').map(f => ({ ...f, caseRef: c.caseRef, learnerName: c.learnerName, officer: c.safeguardingOfficerAssigned })));

export default function LearnerWellbeingPage() {
  const [activeTab, setActiveTab] = useState<string>('Wellbeing Concerns');

  const wellbeingCases = SAFEGUARDING_CASES.filter(c =>
    c.concernType === 'Wellbeing Concern' || c.concernType === 'Mental Health Concern' || c.riskLevel === 'Low Risk'
  ).filter(c => c.status !== 'Closed' && c.status !== 'Archived');

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Learner Wellbeing" pageSubtitle="Wellbeing monitoring, support needs, and vulnerable learner oversight"
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Tabs */}
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

        {/* Wellbeing Concerns */}
        {activeTab === 'Wellbeing Concerns' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Active Wellbeing Cases" value={wellbeingCases.length} icon="ri-heart-line" colour="amber" />
              <StatCard label="Mental Health" value={SAFEGUARDING_CASES.filter(c => c.concernType === 'Mental Health Concern').length} icon="ri-psychotherapy-line" colour="red" />
              <StatCard label="Monitoring Only" value={SAFEGUARDING_CASES.filter(c => c.status === 'Monitoring').length} icon="ri-eye-line" colour="emerald" />
            </div>
            {wellbeingCases.map(kase => (
              <div key={kase.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    kase.concernType === 'Mental Health Concern' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    <i className={`${kase.concernType === 'Mental Health Concern' ? 'ri-psychotherapy-line' : 'ri-heart-line'} text-lg`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-foreground-400">{kase.caseRef}</span>
                        <p className="text-[13px] font-semibold text-foreground-800 mt-0.5">{kase.learnerName}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                        kase.riskLevel === 'High Risk' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}>{kase.riskLevel}</span>
                    </div>
                    <p className="text-[11px] text-foreground-500 mt-1">{kase.concernSummary}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-foreground-400">
                      <span>{kase.programme}</span>
                      <span>·</span>
                      <span>{kase.safeguardingOfficerAssigned}</span>
                      <span>·</span>
                      <span>Review: {kase.reviewDate || '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Support Needs */}
        {activeTab === 'Support Needs' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              Learners with identified support needs including young carers, those with housing difficulties, financial hardship, and medical conditions requiring reasonable adjustments.
            </p>
            {SAFEGUARDING_CASES.filter(c =>
              c.concernType === 'Wellbeing Concern' || c.concernType === 'Attendance-related Welfare Concern' || c.caseRef === 'SG-2026-0031'
            ).filter(c => c.status !== 'Closed' && c.status !== 'Archived' || c.caseRef === 'SG-2026-0031').map(kase => (
              <div key={kase.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className="ri-hand-heart-line text-secondary-600 text-lg"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-800">{kase.learnerName}</p>
                    <p className="text-[11px] text-foreground-500 mt-1">{kase.concernSummary}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {kase.followUpActions.map(fu => (
                        <span key={fu.id} className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          fu.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>{fu.action.split(' (')[0]}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Vulnerable Learners */}
        {activeTab === 'Vulnerable Learners' && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200/50 rounded-xl p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <i className="ri-user-heart-line text-red-600 text-lg"></i>
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-red-900">Active Monitoring — {VULNERABLE_LEARNERS.length} Learners</p>
                <p className="text-[12px] text-red-700 mt-1">These learners require ongoing monitoring and regular welfare checks. Any deterioration in circumstances must be escalated immediately.</p>
              </div>
            </div>
            {VULNERABLE_LEARNERS.map(vl => (
              <div key={vl.name} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    vl.risk.includes('Immediate') ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    <i className="ri-shield-user-line text-lg"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-800">{vl.name}</p>
                    <p className="text-[11px] text-foreground-500">{vl.programme}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        vl.risk.includes('Immediate') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>{vl.risk}</span>
                      <span className="text-[10px] text-red-600 font-medium">{vl.concern}</span>
                      <span className="text-[10px] text-foreground-400 ml-auto">{vl.officer}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Follow-up Actions */}
        {activeTab === 'Follow-up Actions' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Pending" value={allFollowUps.filter(f => f.status === 'Pending').length} icon="ri-time-line" colour="amber" />
              <StatCard label="In Progress" value={allFollowUps.filter(f => f.status === 'In Progress').length} icon="ri-loader-4-line" colour="amber" />
              <StatCard label="Overdue" value={allFollowUps.filter(f => f.status === 'Overdue').length} icon="ri-alert-line" colour="red" />
            </div>
            {allFollowUps.map(fu => (
              <div key={fu.id} className="bg-background-50 rounded-xl border border-background-200/40 p-3 flex items-start gap-3">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                  fu.status === 'Overdue' ? 'bg-red-500' : fu.status === 'In Progress' ? 'bg-amber-500' : 'bg-foreground-300'
                }`}></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-foreground-800">{fu.action}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-foreground-400">
                    <span className="font-mono text-red-500">{fu.caseRef}</span>
                    <span>·</span>
                    <span>{fu.learnerName}</span>
                    <span>·</span>
                    <span>Owner: {fu.owner}</span>
                    <span>·</span>
                    <span className={fu.status === 'Overdue' ? 'text-red-600 font-semibold' : ''}>Deadline: {fu.deadline}</span>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                  fu.status === 'Overdue' ? 'bg-red-100 text-red-700' : fu.status === 'In Progress' ? 'bg-amber-50 text-amber-700' : 'bg-background-100 text-foreground-500'
                }`}>{fu.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function StatCard({ label, value, icon, colour }: { label: string; value: number; icon: string; colour: string }) {
  const colourMap: Record<string, string> = {
    red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${colourMap[colour]} mb-2`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <p className="text-xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-1">{label}</p>
    </div>
  );
}