import type { EligibilityReviewRecord } from '@/mocks/eligibility-review';

interface EligibilityHeaderProps {
  record: EligibilityReviewRecord;
}

export function EligibilityHeader({ record }: EligibilityHeaderProps) {
  const statusConfig = getOverallStatusConfig(record.overallStatus);
  const residencyPassed = record.residencyTests.filter(t => t.status === 'pass').length;
  const residencyTotal = record.residencyTests.length;
  const fundingPassed = record.fundingChecks.filter(f => f.status === 'pass').length;
  const priorAttainmentVerified = record.priorAttainment.filter(p => p.verified).length;
  const decisionConfig = getDecisionConfig(record.eligibilityOutcome.decision);

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      {/* Top row */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <span className="text-primary-700 font-semibold text-lg">{record.learnerName.charAt(0)}</span>
          </div>
          <div>
            <h2 className="text-lg font-heading font-semibold text-foreground-900">{record.learnerName}</h2>
            <p className="text-[13px] text-foreground-500 mt-0.5">{record.programme} &middot; {record.standardCode}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[11px] text-foreground-400">ID: {record.id}</span>
              <span className="text-[8px] text-foreground-300">&middot;</span>
              <span className="text-[11px] text-foreground-400">{record.cohort}</span>
              <span className="text-[8px] text-foreground-300">&middot;</span>
              <span className="text-[11px] text-foreground-400">Target Start: {record.targetStartDate}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${statusConfig.bg} ${statusConfig.text}`}>
            {record.overallStatus}
          </span>
          <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${decisionConfig.bg} ${decisionConfig.text}`}>
            <AppIcon className={`${decisionConfig.icon} text-[10px] mr-1`}></AppIcon>
            {decisionConfig.label}
          </span>
        </div>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <QuickStat label="Residency" value={`${residencyPassed}/${residencyTotal} passed`} icon="ri-home-line" variant={residencyPassed === residencyTotal ? 'pass' : 'warn'} />
        <QuickStat label="Funding" value={`${fundingPassed}/${record.fundingChecks.length} checks passed`} icon="ri-money-pound-circle-line" variant={fundingPassed >= 3 ? 'pass' : 'warn'} />
        <QuickStat label="Prior Attainment" value={`${priorAttainmentVerified}/${record.priorAttainment.length} verified`} icon="ri-graduation-cap-line" variant={priorAttainmentVerified >= record.priorAttainment.length ? 'pass' : 'warn'} />
        <QuickStat label="Right to Work" value={record.rightToWork.status === 'verified' ? 'Verified' : record.rightToWork.status === 'flagged' ? 'Flagged' : 'Pending'} icon="ri-passport-line" variant={record.rightToWork.status === 'verified' ? 'pass' : record.rightToWork.status === 'flagged' ? 'fail' : 'warn'} />
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <DetailItem label="Employer" value={record.employer} icon="ri-building-2-line" />
        <DetailItem label="Line Manager" value={record.lineManager} icon="ri-user-settings-line" />
        <DetailItem label="Reviewer" value={record.reviewer} icon="ri-shield-user-line" highlight />
        <DetailItem label="Case Owner" value={record.caseOwner} icon="ri-user-received-line" />
        <DetailItem label="Enrolment Result" value={record.enrolmentResult} icon="ri-search-eye-line" />
        <DetailItem label="Risk" value={record.riskStatus} icon="ri-alert-line" risk={record.riskStatus} />
        <DetailItem label="Age at Start" value={`${record.ageValidation.ageAtStart} years (min: ${record.ageValidation.meetsMinimum ? 'met' : 'not met'})`} icon="ri-calendar-line" />
        <DetailItem label="Last Updated" value={`${formatDate(record.lastUpdated)} (${record.daysSinceLastUpdate}d ago)`} icon="ri-time-line" />
      </div>

      {/* Next action banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-background-200/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200/50">
            <AppIcon className="ri-alert-line text-amber-600 text-sm"></AppIcon>
            <div>
              <p className="text-[11px] text-amber-800 font-medium">Next Action</p>
              <p className="text-[12px] text-amber-700">{record.nextAction}</p>
            </div>
          </div>
          {record.nextActionDue && (
            <span className="text-[11px] text-foreground-400 whitespace-nowrap">Due: <span className="font-medium text-foreground-600">{record.nextActionDue}</span></span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-foreground-400">Updated: {formatDate(record.lastUpdated)}</span>
          <button className="flex items-center gap-1.5 text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
            <AppIcon className="ri-history-line"></AppIcon>
            Audit Trail
          </button>
        </div>
      </div>

      {record.riskReason && (
        <div className={`mt-3 px-3 py-2 rounded-lg border flex items-start gap-2 ${
          record.riskStatus === 'High' ? 'bg-red-50 border-red-200/50' : 'bg-amber-50 border-amber-200/50'
        }`}>
          <AppIcon className={record.riskStatus === 'High' ? 'ri-error-warning-line text-red-500' : 'ri-alert-line text-amber-500'}></AppIcon>
          <p className={`text-[12px] ${record.riskStatus === 'High' ? 'text-red-700' : 'text-amber-700'}`}>{record.riskReason}</p>
        </div>
      )}
    </div>
  );
}

function QuickStat({ label, value, icon, variant }: { label: string; value: string; icon: string; variant: 'pass' | 'warn' | 'fail' }) {
  const iconBg = variant === 'pass' ? 'bg-emerald-50 text-emerald-600'
    : variant === 'fail' ? 'bg-red-50 text-red-600'
    : 'bg-amber-50 text-amber-600';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-background-50 border border-foreground-200/60">
      <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${iconBg}`}>
        <AppIcon className={`${icon} text-xs`}></AppIcon>
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-foreground-800 truncate">{value}</p>
        <p className="text-[10px] text-foreground-400">{label}</p>
      </div>
    </div>
  );
}

function DetailItem({ label, value, icon, highlight, risk }: {
  label: string; value: string; icon: string; highlight?: boolean; risk?: string;
}) {
  let valueClass = 'text-[13px] text-foreground-700';
  if (highlight) valueClass = 'text-[13px] text-primary-700 font-semibold';
  else if (risk) {
    const rc = risk === 'High' ? 'text-red-600' : risk === 'Medium' ? 'text-amber-600' : 'text-emerald-600';
    valueClass = `text-[13px] ${rc} font-semibold`;
  }
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="w-6 h-6 rounded-md bg-background-100 flex items-center justify-center shrink-0 mt-0.5">
        <AppIcon className={`${icon} text-[11px] text-foreground-400`}></AppIcon>
      </span>
      <div className="min-w-0">
        <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium">{label}</p>
        <p className={valueClass + ' truncate'} title={value}>{value}</p>
      </div>
    </div>
  );
}

function getOverallStatusConfig(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    'Submitted': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'Under Eligibility Review': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'Evidence Required': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'Eligible': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'Not Eligible': { bg: 'bg-red-50', text: 'text-red-700' },
    'Conditionally Eligible': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'Escalated': { bg: 'bg-secondary-50', text: 'text-secondary-700' },
  };
  return map[status] || { bg: 'bg-background-100', text: 'text-foreground-500' };
}

function getDecisionConfig(decision: string): { bg: string; text: string; icon: string; label: string } {
  const map: Record<string, { bg: string; text: string; icon: string; label: string }> = {
    'eligible': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line', label: 'Eligible' },
    'not-eligible': { bg: 'bg-red-50', text: 'text-red-700', icon: 'ri-close-line', label: 'Not Eligible' },
    'conditionally-eligible': { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-time-line', label: 'Conditional' },
    'pending': { bg: 'bg-background-100', text: 'text-foreground-500', icon: 'ri-time-line', label: 'Pending' },
  };
  return map[decision] || { bg: 'bg-background-100', text: 'text-foreground-500', icon: 'ri-question-line', label: 'Pending' };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}