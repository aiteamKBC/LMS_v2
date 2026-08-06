import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { CASE_REVIEWS, SAFEGUARDING_AUDIT, POLICY_RECORDS } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const TABS = ['Case Reviews', 'Safeguarding Audit', 'Policy Records'] as const;

export default function QAAuditPage() {
  const [activeTab, setActiveTab] = useState<string>('Case Reviews');

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="QA & Audit" pageSubtitle="Case review outcomes, safeguarding audits, and policy management"
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

        {activeTab === 'Case Reviews' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              Regular case reviews ensure all active safeguarding cases are appropriately managed and decisions are documented.
            </p>
            {CASE_REVIEWS.map(cr => (
              <div key={cr.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    cr.outcome.includes('Satisfactory') ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    <AppIcon className="ri-search-eye-line text-lg"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-800">{cr.type} — {cr.caseRef}</p>
                        <p className="text-[10px] text-foreground-400">Reviewer: {cr.reviewer} · {cr.date}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        cr.outcome.includes('Satisfactory') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}>{cr.outcome}</span>
                    </div>
                    <p className="text-[11px] text-foreground-600 mt-2 italic">"{cr.recommendations}"</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Safeguarding Audit' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              External and internal audits of safeguarding practices. Audits are conducted monthly by an external safeguarding consultant and quarterly by DSL.
            </p>
            {SAFEGUARDING_AUDIT.map(audit => (
              <div key={audit.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    audit.rating === 'Outstanding' ? 'bg-emerald-100 text-emerald-600' : 'bg-secondary-100 text-secondary-600'
                  }`}>
                    <AppIcon className="ri-history-line text-lg"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-800">{audit.type}</p>
                        <p className="text-[10px] text-foreground-400">{audit.auditor} · {audit.date} · {audit.casesReviewed} cases reviewed</p>
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        audit.rating === 'Outstanding' ? 'bg-emerald-100 text-emerald-700' : 'bg-secondary-100 text-secondary-700'
                      }`}>{audit.rating}</span>
                    </div>
                    <p className="text-[11px] text-foreground-600 mt-2">{audit.findings}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Policy Records' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              All safeguarding policies must be reviewed at least annually. Current versions are listed below.
            </p>
            {POLICY_RECORDS.map(pol => (
              <div key={pol.id} className="bg-background-50 rounded-xl border border-background-200/40 p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    pol.status === 'Current' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    <AppIcon className="ri-file-text-line text-lg"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-800">{pol.name}</p>
                        <p className="text-[10px] text-foreground-400">v{pol.version} · Owner: {pol.owner}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        pol.status === 'Current' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}>{pol.status}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[11px]">
                      <span className="text-foreground-500">Last Reviewed: {pol.lastReviewed}</span>
                      <span className="text-foreground-400">Next Review: {pol.nextReview}</span>
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