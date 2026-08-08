import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { PREVENT_CONCERNS, RISK_ASSESSMENTS, SAFETY_PLANS } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const TABS = ['Prevent Concerns', 'Risk Assessments', 'Safety Plans'] as const;

export default function PreventRiskPage() {
  const [activeTab, setActiveTab] = useState<string>('Prevent Concerns');

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Prevent & Risk" pageSubtitle="Prevent duty compliance, risk assessments, and safety planning"
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

        {activeTab === 'Prevent Concerns' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <AppIcon className="ri-government-line text-amber-600 text-lg"></AppIcon>
                </div>
                <div>
                  <p className="text-sm font-heading font-semibold text-amber-900">Statutory Prevent Duty</p>
                  <p className="text-[12px] text-amber-700 mt-1">
                    Under the Counter-Terrorism and Security Act 2015, we have a statutory duty to have due regard to the need to prevent people from being drawn into terrorism.
                    All Prevent concerns must be reported to the DSL and Prevent Lead immediately.
                  </p>
                </div>
              </div>
            </div>

            {PREVENT_CONCERNS.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <AppIcon className="ri-check-line text-emerald-500 text-2xl"></AppIcon>
                </div>
                <p className="text-sm font-heading font-semibold text-foreground-700">No Active Prevent Concerns</p>
                <p className="text-[12px] text-foreground-400 mt-1">All current learners have been assessed and no Prevent concerns identified.</p>
              </div>
            ) : (
              PREVENT_CONCERNS.map(pc => (
                <div key={pc.id} className="bg-background-50 rounded-xl border-2 border-amber-200 p-4 md:p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <AppIcon className="ri-radar-line text-amber-700 text-xl"></AppIcon>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-foreground-400">{pc.caseRef}</span>
                          <p className="text-sm font-heading font-semibold text-foreground-900 mt-0.5">{pc.learner}</p>
                        </div>
                        <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">{pc.risk}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-4 text-[11px]">
                        <div><span className="text-foreground-400">Channel Ref:</span><br/><span className="font-mono text-amber-700">{pc.channelRef}</span></div>
                        <div><span className="text-foreground-400">Status:</span><br/><span className="font-medium text-foreground-700">{pc.status}</span></div>
                        <div><span className="text-foreground-400">Officer:</span><br/><span className="font-medium text-foreground-700">{pc.officer}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'Risk Assessments' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
                <p className="text-2xl font-heading font-bold text-foreground-800">{RISK_ASSESSMENTS.length}</p>
                <p className="text-[10px] text-foreground-400 mt-1">Total Assessments</p>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
                <p className="text-2xl font-heading font-bold text-red-600">{RISK_ASSESSMENTS.filter(r => r.score.startsWith('High')).length}</p>
                <p className="text-[10px] text-foreground-400 mt-1">High Score</p>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
                <p className="text-2xl font-heading font-bold text-amber-600">{RISK_ASSESSMENTS.filter(r => new Date(r.reviewDue) <= new Date('2026-07-01')).length}</p>
                <p className="text-[10px] text-foreground-400 mt-1">Due This Month</p>
              </div>
            </div>
            {RISK_ASSESSMENTS.map(ra => (
              <div key={ra.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      ra.score.startsWith('High') ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      <AppIcon className="ri-file-warning-line text-lg"></AppIcon>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-foreground-800">{ra.type}</p>
                      <p className="text-[10px] text-foreground-400">{ra.caseRef} · Completed: {ra.date} by {ra.completedBy}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      ra.score.startsWith('High') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>Score: {ra.score}</span>
                    <p className="text-[10px] text-foreground-400 mt-1">Review: {ra.reviewDue}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Safety Plans' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              Active safety plans for learners. All plans must be reviewed at least monthly. Changes must be approved by DSL.
            </p>
            {SAFETY_PLANS.map(sp => (
              <div key={sp.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-secondary-100 flex items-center justify-center">
                      <AppIcon className="ri-shield-check-line text-secondary-600 text-lg"></AppIcon>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-foreground-800">{sp.type} — {sp.learner}</p>
                      <p className="text-[10px] text-foreground-400">{sp.caseRef} · Created: {sp.date} by {sp.createdBy}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{sp.status}</span>
                    <p className="text-[10px] text-foreground-400 mt-1">Review: {sp.reviewDue}</p>
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