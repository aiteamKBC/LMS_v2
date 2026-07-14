import type { EligibilityReviewRecord } from '@/mocks/eligibility-review';

interface EligibilityOutcomeProps {
  record: EligibilityReviewRecord;
}

export function EligibilityOutcome({ record }: EligibilityOutcomeProps) {
  const { eligibilityOutcome, rightToWork, ageValidation, notes } = record;
  const decisionConfig = getDecisionStyle(eligibilityOutcome.decision);

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50">
        <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Eligibility Outcome</h3>
      </div>

      <div className="p-5 space-y-4">
        {/* Decision banner */}
        <div className={`px-4 py-4 rounded-xl border ${decisionConfig.border} ${decisionConfig.bg}`}>
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${decisionConfig.iconBg}`}>
              <i className={`${decisionConfig.icon} ${decisionConfig.iconColor} text-lg`}></i>
            </span>
            <div>
              <p className={`text-[15px] font-heading font-semibold ${decisionConfig.textColor}`}>
                {decisionConfig.label}
              </p>
              {eligibilityOutcome.decidedBy && (
                <p className="text-[12px] text-foreground-400 mt-0.5">
                  Decided by {eligibilityOutcome.decidedBy} on {formatDate(eligibilityOutcome.decidedAt)}
                </p>
              )}
            </div>
          </div>
          {eligibilityOutcome.reason && (
            <p className="mt-3 text-[13px] text-foreground-600 leading-relaxed">{eligibilityOutcome.reason}</p>
          )}
        </div>

        {/* Conditions */}
        {eligibilityOutcome.conditions.length > 0 && (
          <div className="px-4 py-3 rounded-lg border border-amber-200/50 bg-amber-50">
            <p className="text-[12px] font-semibold text-amber-800 mb-2">Conditions to satisfy</p>
            <ul className="space-y-1.5">
              {eligibilityOutcome.conditions.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-amber-700">
                  <i className="ri-checkbox-blank-circle-fill text-[6px] text-amber-400 mt-1.5 shrink-0"></i>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Right to Work + Age */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="px-4 py-3 rounded-lg border border-background-200/50">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-passport-line text-foreground-400"></i>
              <p className="text-[12px] font-semibold text-foreground-800">Right to Work</p>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
              rightToWork.status === 'verified' ? 'bg-emerald-50 text-emerald-700'
              : rightToWork.status === 'flagged' ? 'bg-red-50 text-red-700'
              : 'bg-amber-50 text-amber-700'
            }`}>{rightToWork.status}</span>
            <p className="text-[12px] text-foreground-600 mt-1.5">{rightToWork.document}</p>
            {rightToWork.note && <p className="text-[11px] text-foreground-400 mt-1">{rightToWork.note}</p>}
          </div>
          <div className="px-4 py-3 rounded-lg border border-background-200/50">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-calendar-line text-foreground-400"></i>
              <p className="text-[12px] font-semibold text-foreground-800">Age Validation</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium text-foreground-700">{ageValidation.ageAtStart} years</span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${ageValidation.meetsMinimum ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {ageValidation.meetsMinimum ? 'Meets Minimum' : 'Below Minimum'}
              </span>
            </div>
            <p className="text-[11px] text-foreground-400 mt-1">DOB: {ageValidation.dob}</p>
            {ageValidation.note && <p className="text-[11px] text-foreground-400 mt-0.5">{ageValidation.note}</p>}
          </div>
        </div>

        {/* Notes */}
        {notes.length > 0 && (
          <div>
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-2">Internal Notes</p>
            <div className="space-y-2">
              {notes.map((n, i) => (
                <div key={i} className="px-4 py-3 rounded-lg border border-background-200/50">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] font-medium text-foreground-700">{n.author}</span>
                    <span className="text-[11px] text-foreground-400">{formatDate(n.timestamp)}</span>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400">{n.visibility}</span>
                  </div>
                  <p className="text-[12px] text-foreground-600">{n.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function getDecisionStyle(decision: string): {
  bg: string; border: string; icon: string; iconBg: string; iconColor: string; textColor: string; label: string;
} {
  const map: Record<string, { bg: string; border: string; icon: string; iconBg: string; iconColor: string; textColor: string; label: string }> = {
    'eligible': { bg: 'bg-emerald-50/60', border: 'border-emerald-200/50', icon: 'ri-check-line', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', textColor: 'text-emerald-800', label: 'Eligible — Learner meets all criteria' },
    'not-eligible': { bg: 'bg-red-50/60', border: 'border-red-200/50', icon: 'ri-close-line', iconBg: 'bg-red-100', iconColor: 'text-red-600', textColor: 'text-red-800', label: 'Not Eligible — Learner does not meet criteria' },
    'conditionally-eligible': { bg: 'bg-amber-50/60', border: 'border-amber-200/50', icon: 'ri-time-line', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', textColor: 'text-amber-800', label: 'Conditionally Eligible — Criteria must be satisfied' },
    'pending': { bg: 'bg-background-100', border: 'border-background-200/50', icon: 'ri-time-line', iconBg: 'bg-background-200', iconColor: 'text-foreground-400', textColor: 'text-foreground-600', label: 'Decision Pending' },
  };
  return map[decision] || map['pending'];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}