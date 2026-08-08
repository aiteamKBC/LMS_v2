import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SAFEGUARDING_CASES, SAFEGUARDING_OFFICERS } from '@/mocks/safeguarding';
import { useToast } from '@/hooks/useToast';

const sgConfig = roleNavMap.safeguarding;

const newConcerns = SAFEGUARDING_CASES.filter(c =>
  c.status === 'New Concern' || c.riskLevel === 'New Concern' || c.riskLevel === 'Triage Required'
);

// If none match, use the most recently reported cases as "new concerns"
const displayCases = newConcerns.length > 0 ? newConcerns : SAFEGUARDING_CASES.filter(c =>
  c.dateReported >= '2026-06-01'
).slice(0, 5);

export default function NewConcernsPage() {
  const { success, warning, info } = useToast();
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [assignedRisk, setAssignedRisk] = useState<Record<string, string>>({});
  const [assignedOfficer, setAssignedOfficer] = useState<Record<string, string>>({});
  const [triaged, setTriaged] = useState<Set<string>>(new Set());

  const handleTriage = (kaseId: string, caseRef: string) => {
    const risk = assignedRisk[kaseId];
    const officer = assignedOfficer[kaseId];

    if (!risk || risk === 'Assign Risk Level...') {
      warning('Risk Level Required', 'Please select a risk level before triaging.');
      return;
    }
    if (!officer || officer === 'Assign Officer...') {
      warning('Officer Required', 'Please assign an officer before triaging.');
      return;
    }

    setTriaged(prev => new Set([...prev, kaseId]));
    setSelectedCase(null);
    success(`${caseRef} Triaged`, `Risk: ${risk} · Assigned to ${officer}`);
  };

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="New Concerns" pageSubtitle="Cases awaiting triage and initial assessment"
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Alert Banner */}
        <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AppIcon className="ri-alert-line text-amber-600 text-lg"></AppIcon>
          </div>
          <div>
            <p className="text-sm font-heading font-semibold text-amber-900">Triage Required</p>
            <p className="text-[12px] text-amber-700 mt-1">
              {displayCases.length - triaged.size} concern(s) still require initial triage assessment. All new concerns must be reviewed within 24 hours of reporting as per Safeguarding Policy v4.2.
              Cases should be assigned a risk level and allocated to a Safeguarding Officer.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-amber-600">{displayCases.length - triaged.size}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Pending Triage</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-red-600">{displayCases.filter(c => c.riskLevel === 'High Risk' || c.riskLevel === 'Immediate Action Required').length}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Flagged High Risk</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-emerald-600">{triaged.size}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Triaged Today</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-800">{displayCases.filter(c => c.dslReviewRequired).length}</p>
            <p className="text-[10px] text-foreground-400 mt-1">Require DSL Review</p>
          </div>
        </div>

        {/* Concerns */}
        <div className="space-y-3">
          {displayCases.map(kase => (
            <div
              key={kase.id}
              onClick={() => !triaged.has(kase.id) && setSelectedCase(selectedCase === kase.id ? null : kase.id)}
              className={`bg-background-50 rounded-xl border p-4 transition-smooth ${
                triaged.has(kase.id) ? 'border-emerald-200/60 bg-emerald-50/20 opacity-75' : 'border-background-200/40 cursor-pointer hover:border-amber-200/40'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${triaged.has(kase.id) ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  <AppIcon className={`${triaged.has(kase.id) ? 'ri-check-double-line text-emerald-600' : 'ri-alert-line text-amber-600'} text-lg`}></AppIcon>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono text-foreground-400">{kase.caseRef}</span>
                      <p className="text-sm font-semibold text-foreground-800 mt-0.5">{kase.learnerName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {triaged.has(kase.id) ? (
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">Triaged</span>
                      ) : (
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/50">Triage Required</span>
                      )}
                      {kase.dslReviewRequired && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700">DSL</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[12px] text-foreground-600 mt-2">{kase.concernSummary}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{kase.concernType}</span>
                    <span className="text-[10px] text-foreground-400">{kase.programme} · {kase.employer}</span>
                    <span className="text-[10px] text-foreground-400 ml-auto">Reported: {kase.dateReported} by {kase.reportedByRole}</span>
                  </div>

                  {selectedCase === kase.id && !triaged.has(kase.id) && (
                    <div className="mt-4 pt-4 border-t border-foreground-200/60 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div><span className="text-foreground-400">Source:</span> <span className="text-foreground-700">{kase.sourceOfConcern}</span></div>
                        <div><span className="text-foreground-400">Reported By:</span> <span className="text-foreground-700">{kase.reportedBy}</span></div>
                        <div><span className="text-foreground-400">Tenant:</span> <span className="text-foreground-700">{kase.tenant}</span></div>
                        <div><span className="text-foreground-400">Date:</span> <span className="text-foreground-700">{kase.dateReported}</span></div>
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={assignedRisk[kase.id] || 'Assign Risk Level...'}
                          onChange={e => setAssignedRisk(prev => ({ ...prev, [kase.id]: e.target.value }))}
                          className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer flex-1"
                        >
                          <option disabled>Assign Risk Level...</option>
                          <option>Immediate Action Required</option>
                          <option>High Risk</option>
                          <option>Medium Risk</option>
                          <option>Low Risk</option>
                          <option>Monitoring</option>
                        </select>
                        <select
                          value={assignedOfficer[kase.id] || 'Assign Officer...'}
                          onChange={e => setAssignedOfficer(prev => ({ ...prev, [kase.id]: e.target.value }))}
                          className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer flex-1"
                        >
                          <option disabled>Assign Officer...</option>
                          {SAFEGUARDING_OFFICERS.map(o => (
                            <option key={o.id} value={o.name}>{o.name} ({o.role})</option>
                          ))}
                        </select>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTriage(kase.id, kase.caseRef); }}
                          className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          Triage Case
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {displayCases.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <AppIcon className="ri-check-double-line text-emerald-500 text-2xl"></AppIcon>
            </div>
            <p className="text-sm font-heading font-semibold text-foreground-700">No New Concerns</p>
            <p className="text-[12px] text-foreground-400 mt-1">All concerns have been triaged. New concerns will appear here when reported.</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}