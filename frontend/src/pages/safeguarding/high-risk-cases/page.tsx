import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SAFEGUARDING_CASES, type SafeguardingCase } from '@/mocks/safeguarding';
import { useToast } from '@/hooks/useToast';

const sgConfig = roleNavMap.safeguarding;

const highRiskCases = SAFEGUARDING_CASES.filter(c =>
  c.riskLevel === 'High Risk' || c.riskLevel === 'Immediate Action Required'
).filter(c => c.status !== 'Closed' && c.status !== 'Archived');

// ─── Take Action Modal ──────────────────────────────────────────────────
function TakeActionModal({ kase, onClose, onConfirm }: { kase: SafeguardingCase; onClose: () => void; onConfirm: (action: string, detail: string) => void }) {
  const [actionType, setActionType] = useState('');
  const [detail, setDetail] = useState('');
  const actionOptions = ['Conduct Risk Assessment', 'Arrange Emergency Meeting', 'Make External Referral', 'Contact Emergency Services', 'Implement Safety Plan', 'Notify Senior Leadership', 'Issue Safeguarding Alert', 'Schedule DSL Review'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <div>
            <p className="text-sm font-semibold text-foreground-900">Take Action</p>
            <p className="text-[11px] text-foreground-500 mt-0.5">{kase.caseRef} · {kase.learnerName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 rounded-lg p-3 border border-red-200/50">
            <div className="flex items-center gap-2 mb-1">
              <AppIcon className="ri-error-warning-fill text-red-500"></AppIcon>
              <p className="text-[11px] font-bold text-red-700 uppercase tracking-wider">{kase.riskLevel}</p>
            </div>
            <p className="text-[12px] text-red-800">{kase.concernSummary.slice(0, 120)}...</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Action Type</label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {actionOptions.map(a => (
                <button
                  key={a}
                  onClick={() => setActionType(a)}
                  className={`text-left px-3 py-2 rounded-lg text-[11px] border transition-smooth cursor-pointer whitespace-nowrap ${actionType === a ? 'bg-red-50 text-red-700 border-red-300' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-red-200'}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Detail / Notes</label>
            <textarea
              value={detail}
              onChange={e => setDetail(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Describe the action being taken..."
              className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-red-400 resize-none"
            />
            <p className="text-[10px] text-foreground-400 text-right">{detail.length}/500</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button
              onClick={() => actionType && detail.trim() && onConfirm(actionType, detail.trim())}
              disabled={!actionType || !detail.trim()}
              className="flex-1 px-3 py-2.5 bg-red-600 text-white rounded-lg text-[12px] font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-play-circle-line mr-1"></AppIcon> Execute Action
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Escalate Modal ────────────────────────────────────────────────────
function EscalateModal({ kase, onClose, onConfirm }: { kase: SafeguardingCase; onClose: () => void; onConfirm: (target: string, reason: string) => void }) {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const targets = ['DSL (Dr. Eleanor Vance)', 'Deputy DSL (Marcus Adewale)', 'Prevent Lead (Sarah Okonkwo)', 'Mental Health Lead (Priya Kapoor)', 'Senior Leadership Team', 'External — Local Authority', 'External — Police', 'External — MARAC'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <p className="text-sm font-semibold text-foreground-900">Escalate {kase.caseRef}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Escalate To</label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {targets.map(t => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[11px] border transition-smooth cursor-pointer ${target === t ? 'bg-red-50 text-red-700 border-red-300' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-red-200'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-2">Reason</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Reason for escalation..."
              className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-red-400 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button
              onClick={() => target && reason.trim() && onConfirm(target, reason.trim())}
              disabled={!target || !reason.trim()}
              className="flex-1 px-3 py-2.5 bg-amber-500 text-white rounded-lg text-[12px] font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-arrow-up-circle-line mr-1"></AppIcon> Escalate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function HighRiskCasesPage() {
  const { success, warning, info } = useToast();
  const [cases, setCases] = useState<SafeguardingCase[]>(highRiskCases);
  const [selectedCase, setSelectedCase] = useState<SafeguardingCase | null>(null);

  // Modal state
  const [actionTarget, setActionTarget] = useState<SafeguardingCase | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<SafeguardingCase | null>(null);

  const handleTakeAction = (action: string, detail: string) => {
    const kase = actionTarget;
    if (!kase) return;
    setActionTarget(null);
    setSelectedCase(null);
    success(`${action} — ${kase.caseRef}`, detail.slice(0, 80));
  };

  const handleEscalate = (target: string, reason: string) => {
    const kase = escalateTarget;
    if (!kase) return;
    const newEntry = { date: new Date().toISOString().split('T')[0], from: 'DSL', to: target, reason };
    setCases(prev => prev.map(c => c.id === kase.id ? { ...c, dslReviewStatus: 'Escalated' as const, escalationHistory: [...c.escalationHistory, newEntry] } : c));
    setSelectedCase(prev => prev?.id === kase.id ? { ...prev, dslReviewStatus: 'Escalated' as const, escalationHistory: [...prev.escalationHistory, newEntry] } : prev);
    setEscalateTarget(null);
    warning(`${kase.caseRef} Escalated`, `Escalated to ${target}`);
  };

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="High-Risk Cases" pageSubtitle={`${cases.length} cases requiring immediate or heightened attention`}
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Critical Banner */}
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 flex flex-col sm:flex-row items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-red-500 flex items-center justify-center shrink-0">
            <AppIcon className="ri-error-warning-fill text-white text-xl"></AppIcon>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-heading font-bold text-red-900">
              High-Risk & Immediate Action Cases
            </p>
            <p className="text-[12px] text-red-700 mt-1">
              {cases.filter(c => c.riskLevel === 'Immediate Action Required').length} case(s) require immediate action.
              {cases.filter(c => c.riskLevel === 'High Risk').length} case(s) at high risk level.
              These cases take priority over all other safeguarding work. DSL must be informed of any status changes.
            </p>
          </div>
        </div>

        {/* Cases */}
        <div className="space-y-4">
          {cases.map(kase => (
            <div
              key={kase.id}
              onClick={() => setSelectedCase(selectedCase?.id === kase.id ? null : kase)}
              className={`bg-background-50 rounded-xl border-2 p-4 md:p-5 cursor-pointer transition-smooth ${
                kase.riskLevel === 'Immediate Action Required'
                  ? 'border-red-300 bg-red-50/40'
                  : 'border-red-200/50 hover:border-red-300/60'
              } ${selectedCase?.id === kase.id ? 'ring-2 ring-red-300/30' : ''}`}
            >
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Left — Case Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      kase.riskLevel === 'Immediate Action Required' ? 'bg-red-500 text-white animate-pulse-slow' : 'bg-red-100 text-red-600'
                    }`}>
                      <AppIcon className={`${kase.riskLevel === 'Immediate Action Required' ? 'ri-alarm-warning-line' : 'ri-error-warning-line'} text-lg`}></AppIcon>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-mono text-red-500 font-semibold">{kase.caseRef}</span>
                          <p className="text-sm font-heading font-semibold text-foreground-900 mt-0.5">{kase.learnerName}</p>
                        </div>
                        <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                          kase.riskLevel === 'Immediate Action Required'
                            ? 'bg-red-500 text-white'
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {kase.riskLevel}
                        </span>
                      </div>
                      <p className="text-[12px] text-foreground-600 mt-2">{kase.concernSummary}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600">{kase.concernType}</span>
                        <span className="text-[10px] text-foreground-400">{kase.programme} · {kase.employer}</span>
                        <span className="text-[10px] text-foreground-400">{kase.safeguardingOfficerAssigned}</span>
                        <span className="text-[10px] text-foreground-400 ml-auto">{kase.dateReported}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right — Actions Summary */}
                <div className="lg:w-64 shrink-0 border-t lg:border-t-0 lg:border-l border-red-200/30 pt-3 lg:pt-0 lg:pl-4">
                  <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Status Overview</p>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-foreground-500">DSL Review:</span>
                      <span className={`font-semibold ${
                        kase.dslReviewStatus === 'Escalated' ? 'text-red-600' : kase.dslReviewStatus === 'Reviewed' ? 'text-emerald-600' : 'text-amber-600'
                      }`}>{kase.dslReviewStatus}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-foreground-500">Referrals:</span>
                      <span className={`font-semibold ${kase.referralStatus !== 'None' ? 'text-red-600' : 'text-foreground-500'}`}>{kase.referralStatus}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-foreground-500">Follow-ups:</span>
                      <span className="font-semibold text-foreground-700">
                        {kase.followUpActions.filter(f => f.status === 'Completed').length}/{kase.followUpActions.length} done
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-foreground-500">Review Date:</span>
                      <span className="font-semibold text-foreground-700">{kase.reviewDate || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-foreground-500">Attachments:</span>
                      <span className="font-semibold text-foreground-700">{kase.attachments.length}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setActionTarget(kase); }}
                      className="flex-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      Take Action
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEscalateTarget(kase); }}
                      className="px-3 py-1.5 bg-background-100 border border-background-200 rounded-lg text-[11px] text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      Escalate
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {selectedCase?.id === kase.id && (
                <div className="mt-4 pt-4 border-t border-red-200/30 space-y-4 animate-in slide-in-from-bottom-2 duration-200">
                  {/* Immediate Action */}
                  {kase.immediateActionRequired && (
                    <div className="bg-red-100/70 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Immediate Action Taken</p>
                      <p className="text-[12px] text-red-800 mt-1">{kase.immediateActionDetail}</p>
                    </div>
                  )}

                  {/* Secure Notes */}
                  {kase.secureNotes && (
                    <div className="bg-amber-50/70 rounded-lg p-3 border border-amber-200/30">
                      <div className="flex items-center gap-1.5 mb-1">
                        <AppIcon className="ri-lock-line text-amber-600 text-xs"></AppIcon>
                        <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Secure Notes — Restricted</p>
                      </div>
                      <p className="text-[12px] text-amber-900 mt-1">{kase.secureNotes}</p>
                    </div>
                  )}

                  {/* Follow-ups */}
                  <div>
                    <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Follow-up Actions</p>
                    {kase.followUpActions.map(fu => (
                      <div key={fu.id} className="flex items-center gap-2 text-[11px] py-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          fu.status === 'Completed' ? 'bg-emerald-500' : fu.status === 'Overdue' ? 'bg-red-500' : fu.status === 'In Progress' ? 'bg-amber-500' : 'bg-foreground-300'
                        }`}></span>
                        <span className="text-foreground-700 flex-1">{fu.action}</span>
                        <span className="text-foreground-400">{fu.owner} · {fu.deadline}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          fu.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : fu.status === 'Overdue' ? 'bg-red-50 text-red-700' : fu.status === 'In Progress' ? 'bg-amber-50 text-amber-700' : 'bg-background-100 text-foreground-500'
                        }`}>{fu.status}</span>
                      </div>
                    ))}
                  </div>

                  {/* Escalation History */}
                  {kase.escalationHistory.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Escalation History</p>
                      {kase.escalationHistory.map((esc, i) => (
                        <div key={i} className="text-[11px] text-foreground-600 py-1 border-b border-background-100/50 last:border-0">
                          <span className="font-medium">{esc.date}</span> — From <span className="font-medium">{esc.from}</span> to <span className="font-medium text-red-600">{esc.to}</span>
                          <p className="text-foreground-500 mt-0.5">{esc.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Referral History */}
                  {kase.referralHistory.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Referral History</p>
                      {kase.referralHistory.map((ref, i) => (
                        <div key={i} className="text-[11px] text-foreground-600 py-1 border-b border-background-100/50 last:border-0">
                          <span className="font-medium">{ref.date}</span> — <span className="font-semibold text-red-600">{ref.type}</span> to {ref.organisation}
                          <p className="text-foreground-500 mt-0.5">{ref.outcome}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {actionTarget && (
        <TakeActionModal
          kase={actionTarget}
          onClose={() => setActionTarget(null)}
          onConfirm={handleTakeAction}
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