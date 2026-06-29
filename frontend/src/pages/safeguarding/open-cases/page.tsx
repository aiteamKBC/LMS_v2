import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SAFEGUARDING_CASES, SAFEGUARDING_OFFICERS, type SafeguardingCase } from '@/mocks/safeguarding';
import { useToast } from '@/hooks/useToast';

const sgConfig = roleNavMap.safeguarding;

const openCases = SAFEGUARDING_CASES.filter(c => c.status !== 'Closed' && c.status !== 'Archived');

// ─── Assign Officer Modal ──────────────────────────────────────────────
function AssignOfficerModal({ kase, onClose, onConfirm }: { kase: SafeguardingCase; onClose: () => void; onConfirm: (officerName: string) => void }) {
  const [selected, setSelected] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <div>
            <p className="text-sm font-semibold text-foreground-900">Assign Officer</p>
            <p className="text-[11px] text-foreground-500 mt-0.5">{kase.caseRef} · {kase.learnerName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-foreground-600">Currently assigned: <strong className="text-foreground-800">{kase.safeguardingOfficerAssigned}</strong></p>
          <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mt-3 mb-1">Reassign To</p>
          <div className="space-y-2">
            {SAFEGUARDING_OFFICERS.filter(o => o.name !== kase.safeguardingOfficerAssigned).map(o => (
              <button
                key={o.id}
                onClick={() => setSelected(o.name)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-[12px] border transition-smooth cursor-pointer flex items-center gap-3 ${selected === o.name ? 'bg-red-50 text-red-700 border-red-300' : 'bg-background-50 text-foreground-700 border-background-200 hover:border-red-200'}`}
              >
                <span className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-[10px] font-bold">{o.initials}</span>
                <div>
                  <p className="font-semibold">{o.name}</p>
                  <p className="text-[10px] text-foreground-400">{o.role}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button
              onClick={() => selected && onConfirm(selected)}
              disabled={!selected}
              className="flex-1 px-3 py-2.5 bg-red-500 text-white rounded-lg text-[12px] font-semibold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-user-received-line mr-1"></i> Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Escalate Case Modal ────────────────────────────────────────────────
function EscalateModal({ kase, onClose, onConfirm }: { kase: SafeguardingCase; onClose: () => void; onConfirm: (reason: string, target: string) => void }) {
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const escalationTargets = ['External Agency (Police)', 'Local Authority Safeguarding Board', 'MARAC Panel', 'LADO', 'Prevent / Channel', 'Ofsted', 'Employer Senior Leadership', 'Internal DSL Review'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <div>
            <p className="text-sm font-semibold text-foreground-900">Escalate Case</p>
            <p className="text-[11px] text-foreground-500 mt-0.5">{kase.caseRef} · {kase.learnerName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 rounded-lg p-3 border border-red-200/50">
            <p className="text-[11px] font-bold text-red-700 uppercase tracking-wider">Warning</p>
            <p className="text-[12px] text-red-700 mt-1">This case is currently at <strong>{kase.riskLevel}</strong>. Escalating will notify all relevant parties and create an audit entry.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Escalate To</label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {escalationTargets.map(t => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className={`text-left px-3 py-2 rounded-lg text-[11px] border transition-smooth cursor-pointer whitespace-nowrap ${target === t ? 'bg-red-50 text-red-700 border-red-300' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-red-200'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Reason for Escalation</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Describe why this case needs escalation..."
              className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-red-400 resize-none"
            />
            <p className="text-[10px] text-foreground-400 text-right">{reason.length}/500</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button
              onClick={() => reason.trim() && target && onConfirm(reason.trim(), target)}
              disabled={!reason.trim() || !target}
              className="flex-1 px-3 py-2.5 bg-red-600 text-white rounded-lg text-[12px] font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-arrow-up-circle-line mr-1"></i> Confirm Escalation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function OpenCasesPage() {
  const { success, warning, error: toastError, info } = useToast();
  const [cases, setCases] = useState<SafeguardingCase[]>(openCases);
  const [selectedCase, setSelectedCase] = useState<SafeguardingCase | null>(null);
  const [filterRisk, setFilterRisk] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');

  // Modal state
  const [assignTarget, setAssignTarget] = useState<SafeguardingCase | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<SafeguardingCase | null>(null);

  const filtered = cases.filter(c => {
    if (filterRisk !== 'all' && c.riskLevel !== filterRisk) return false;
    if (filterType !== 'all' && c.concernType !== filterType) return false;
    if (search && !c.learnerName.toLowerCase().includes(search.toLowerCase()) && !c.caseRef.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const concernTypes = [...new Set(cases.map(c => c.concernType))];

  const handleAssignOfficer = (officerName: string) => {
    const kase = assignTarget;
    if (!kase) return;
    setCases(prev => prev.map(c => c.id === kase.id ? { ...c, safeguardingOfficerAssigned: officerName } : c));
    setSelectedCase(prev => prev?.id === kase.id ? { ...prev, safeguardingOfficerAssigned: officerName } : prev);
    setAssignTarget(null);
    success('Officer Reassigned', `${officerName} now assigned to ${kase.caseRef}`);
  };

  const handleEscalate = (reason: string, target: string) => {
    const kase = escalateTarget;
    if (!kase) return;
    const newEntry = { date: new Date().toISOString().split('T')[0], from: 'DSL', to: target, reason };
    setCases(prev => prev.map(c => c.id === kase.id ? { ...c, dslReviewStatus: 'Escalated' as const, escalationHistory: [...c.escalationHistory, newEntry] } : c));
    setSelectedCase(prev => prev?.id === kase.id ? { ...prev, dslReviewStatus: 'Escalated' as const, escalationHistory: [...prev.escalationHistory, newEntry] } : prev);
    setEscalateTarget(null);
    warning('Case Escalated', `${kase.caseRef} escalated to ${target}`);
  };

  const handleContactEmployer = (kase: SafeguardingCase) => {
    info('Contacting Employer', `Opening communication for ${kase.caseRef} · ${kase.learnerName}`);
  };

  const handleViewProfile = (kase: SafeguardingCase) => {
    info('Viewing Profile', `Navigating to full profile for ${kase.learnerName}`);
  };

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Open Safeguarding Cases" pageSubtitle={`${cases.length} active cases — Restricted Access`}
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-xs"></i>
            <input
              type="text" placeholder="Search by learner name or case ref..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-red-300 transition-smooth"
            />
          </div>
          <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)} className="text-[12px] border border-background-200 rounded-lg px-2.5 py-2 bg-background-50 text-foreground-600 cursor-pointer">
            <option value="all">All Risk Levels</option>
            <option value="Immediate Action Required">Immediate Action Required</option>
            <option value="High Risk">High Risk</option>
            <option value="Medium Risk">Medium Risk</option>
            <option value="Low Risk">Low Risk</option>
            <option value="Monitoring">Monitoring</option>
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-[12px] border border-background-200 rounded-lg px-2.5 py-2 bg-background-50 text-foreground-600 cursor-pointer">
            <option value="all">All Concern Types</option>
            {concernTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Case List */}
        <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
          <div className={`${selectedCase ? 'lg:w-1/2' : 'w-full'} space-y-2 transition-all duration-300`}>
            {filtered.map(kase => (
              <button
                key={kase.id}
                onClick={() => setSelectedCase(selectedCase?.id === kase.id ? null : kase)}
                className={`w-full text-left bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer group ${
                  selectedCase?.id === kase.id ? 'border-red-300/60 bg-red-50/30' : 'border-background-200/40 hover:border-red-200/40'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    kase.riskLevel === 'Immediate Action Required' ? 'bg-red-500 animate-pulse' :
                    kase.riskLevel === 'High Risk' ? 'bg-red-400' : kase.riskLevel === 'Medium Risk' ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-mono text-foreground-400">{kase.caseRef}</span>
                        <p className="text-[13px] font-semibold text-foreground-800 mt-0.5">{kase.learnerName}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          kase.riskLevel === 'Immediate Action Required' ? 'bg-red-100 text-red-700 border border-red-200' :
                          kase.riskLevel === 'High Risk' ? 'bg-red-50 text-red-700 border border-red-200/50' :
                          kase.riskLevel === 'Medium Risk' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                          'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                        }`}>{kase.riskLevel}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-foreground-500 mt-1 line-clamp-2">{kase.concernSummary}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600">{kase.concernType}</span>
                      <span className="text-[10px] text-foreground-400">{kase.programme}</span>
                      <span className="text-[10px] text-foreground-300">·</span>
                      <span className="text-[10px] text-foreground-400">{kase.employer}</span>
                      <span className="text-[10px] text-foreground-300 ml-auto">{kase.dateReported}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Detail Panel */}
          {selectedCase && (
            <div className="lg:w-1/2 bg-background-50 rounded-xl border border-red-200/50 p-4 md:p-5 animate-in slide-in-from-right-2 duration-300 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-[10px] font-mono text-red-500 font-semibold">{selectedCase.caseRef}</span>
                  <h3 className="text-base font-heading font-semibold text-foreground-900 mt-0.5">{selectedCase.learnerName}</h3>
                </div>
                <button onClick={() => setSelectedCase(null)} className="text-foreground-300 hover:text-foreground-500 cursor-pointer">
                  <i className="ri-close-line text-lg"></i>
                </button>
              </div>

              {/* Case metadata */}
              <div className="grid grid-cols-2 gap-2 mb-4 text-[11px]">
                <div><span className="text-foreground-400">Programme:</span> <span className="text-foreground-700">{selectedCase.programme}</span></div>
                <div><span className="text-foreground-400">Employer:</span> <span className="text-foreground-700">{selectedCase.employer}</span></div>
                <div><span className="text-foreground-400">Reported:</span> <span className="text-foreground-700">{selectedCase.dateReported}</span></div>
                <div><span className="text-foreground-400">Reported By:</span> <span className="text-foreground-700">{selectedCase.reportedBy}</span></div>
                <div><span className="text-foreground-400">Officer:</span> <span className="text-foreground-700">{selectedCase.safeguardingOfficerAssigned}</span></div>
                <div><span className="text-foreground-400">DSL Review:</span> <span className={`font-semibold ${selectedCase.dslReviewStatus === 'Escalated' ? 'text-red-600' : selectedCase.dslReviewStatus === 'Reviewed' ? 'text-emerald-600' : 'text-amber-600'}`}>{selectedCase.dslReviewStatus}</span></div>
              </div>

              <div className="mb-4">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-1">Concern Summary</p>
                <p className="text-[12px] text-foreground-700 leading-relaxed">{selectedCase.concernSummary}</p>
              </div>

              {selectedCase.immediateActionRequired && (
                <div className="bg-red-50 rounded-lg p-3 mb-4 border border-red-200/50">
                  <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Immediate Action Taken</p>
                  <p className="text-[12px] text-red-800 mt-1">{selectedCase.immediateActionDetail}</p>
                </div>
              )}

              {/* Follow-up Actions */}
              <div className="mb-4">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Follow-up Actions</p>
                <div className="space-y-1.5">
                  {selectedCase.followUpActions.map(fu => (
                    <div key={fu.id} className="flex items-center gap-2 text-[11px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        fu.status === 'Completed' ? 'bg-emerald-500' : fu.status === 'Overdue' ? 'bg-red-500' : fu.status === 'In Progress' ? 'bg-amber-500' : 'bg-foreground-300'
                      }`}></span>
                      <span className="text-foreground-700 flex-1">{fu.action}</span>
                      <span className="text-foreground-400 whitespace-nowrap">{fu.owner} · {fu.deadline}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        fu.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : fu.status === 'Overdue' ? 'bg-red-50 text-red-700' : fu.status === 'In Progress' ? 'bg-amber-50 text-amber-700' : 'bg-background-100 text-foreground-500'
                      }`}>{fu.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-foreground-200/60">
                <button
                  onClick={() => setAssignTarget(selectedCase)}
                  className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-user-received-line mr-1"></i> Assign Officer
                </button>
                <button
                  onClick={() => setEscalateTarget(selectedCase)}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-arrow-up-circle-line mr-1"></i> Escalate
                </button>
                <button
                  onClick={() => handleContactEmployer(selectedCase)}
                  className="px-3 py-1.5 bg-background-100 border border-background-200 rounded-lg text-[11px] text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-building-line mr-1"></i> Contact Employer
                </button>
                <button
                  onClick={() => handleViewProfile(selectedCase)}
                  className="px-3 py-1.5 bg-background-100 border border-background-200 rounded-lg text-[11px] text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap ml-auto"
                >
                  <i className="ri-user-line mr-1"></i> View Profile
                </button>
              </div>

              {/* Audit Trail */}
              <div className="mt-4 pt-4 border-t border-foreground-200/60">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Audit Trail</p>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {selectedCase.auditTrail.map(at => (
                    <div key={at.id} className="flex items-start gap-2 text-[10px] py-1 border-b border-background-100/50 last:border-0">
                      <span className={`w-1 h-1 rounded-full mt-1 shrink-0 ${at.visibility === 'restricted' ? 'bg-red-400' : 'bg-secondary-400'}`}></span>
                      <div>
                        <span className="text-foreground-500">{at.timestamp}</span>
                        <span className="text-foreground-300 mx-1">·</span>
                        <span className="font-medium text-foreground-700">{at.action}</span>
                        <span className="text-foreground-300 mx-1">—</span>
                        <span className="text-foreground-500">{at.user} ({at.role})</span>
                        <p className="text-foreground-400 mt-0.5">{at.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attachments */}
              {selectedCase.attachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-foreground-200/60">
                  <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Attachments ({selectedCase.attachments.length})</p>
                  {selectedCase.attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] py-1">
                      <i className={`${att.type === 'PDF' ? 'ri-file-pdf-line text-red-500' : 'ri-file-text-line text-secondary-500'} text-sm`}></i>
                      <span className="text-foreground-600">{att.name}</span>
                      <span className="text-foreground-300 ml-auto text-[10px]">{att.uploadedBy} · {att.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {assignTarget && (
        <AssignOfficerModal
          kase={assignTarget}
          onClose={() => setAssignTarget(null)}
          onConfirm={handleAssignOfficer}
        />
      )}
      {escalateTarget && (
        <EscalateModal
          kase={escalateTarget}
          onClose={() => setEscalateTarget(null)}
          onConfirm={handleEscalate}
        />
      )}
    </WorkspaceShell>
  );
}