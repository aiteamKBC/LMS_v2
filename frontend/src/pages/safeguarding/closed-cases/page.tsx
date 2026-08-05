import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SAFEGUARDING_CASES } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const closedCases = SAFEGUARDING_CASES.filter(c => c.status === 'Closed' || c.status === 'Archived');

export default function ClosedCasesPage() {
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Closed & Archived Cases" pageSubtitle={`${closedCases.length} cases — All resolved and no longer active`}
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-emerald-600">{closedCases.length}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Total Closed</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-800">{closedCases.filter(c => c.status === 'Archived').length}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Archived</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-amber-600">{closedCases.filter(c => !c.caseClosureReason).length}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Awaiting Audit</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-800">6m</p>
            <p className="text-[10px] text-foreground-400 mt-1">Retention Period</p>
          </div>
        </div>

        <div className="space-y-3">
          {closedCases.map(kase => (
            <div
              key={kase.id}
              onClick={() => setSelectedCase(selectedCase === kase.id ? null : kase.id)}
              className="bg-background-50 rounded-xl border border-background-200/40 p-4 cursor-pointer hover:border-emerald-200/40 transition-smooth"
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  kase.status === 'Archived' ? 'bg-foreground-100 text-foreground-500' : 'bg-emerald-100 text-emerald-600'
                }`}>
                  <AppIcon className={`${kase.status === 'Archived' ? 'ri-archive-line' : 'ri-check-double-line'} text-lg`}></AppIcon>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-foreground-400">{kase.caseRef}</span>
                      <p className="text-[13px] font-semibold text-foreground-800 mt-0.5">{kase.learnerName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                        kase.status === 'Archived' ? 'bg-foreground-100 text-foreground-500' : 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                      }`}>{kase.status}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-foreground-500 mt-1">{kase.concernSummary}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{kase.concernType}</span>
                    <span className="text-[10px] text-foreground-400">{kase.programme}</span>
                    <span className="text-[10px] text-foreground-400 ml-auto">Reported: {kase.dateReported}</span>
                    <span className="text-[10px] text-foreground-300">·</span>
                    <span className="text-[10px] text-foreground-400">Officer: {kase.safeguardingOfficerAssigned}</span>
                  </div>

                  {selectedCase === kase.id && (
                    <div className="mt-4 pt-4 border-t border-foreground-200/60 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
                      {kase.caseClosureReason && (
                        <div className="bg-emerald-50 rounded-lg p-3">
                          <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Closure Reason</p>
                          <p className="text-[12px] text-emerald-800 mt-1">{kase.caseClosureReason}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div><span className="text-foreground-400">Closure Date:</span> <span className="text-foreground-700">{kase.reviewDate || '—'}</span></div>
                        <div><span className="text-foreground-400">Attachments:</span> <span className="text-foreground-700">{kase.attachments.length}</span></div>
                        <div><span className="text-foreground-400">Follow-ups Completed:</span> <span className="text-foreground-700">{kase.followUpActions.filter(f => f.status === 'Completed').length}/{kase.followUpActions.length}</span></div>
                        <div><span className="text-foreground-400">Referrals:</span> <span className="text-foreground-700">{kase.referralHistory.length}</span></div>
                      </div>
                      {kase.auditTrail.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-1">Audit Summary</p>
                          <p className="text-[11px] text-foreground-500">{kase.auditTrail.length} entries · First: {kase.auditTrail[kase.auditTrail.length - 1]?.timestamp} · Last: {kase.auditTrail[0]?.timestamp}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}