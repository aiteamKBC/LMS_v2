import type { PreActiveLearner } from '@/mocks/pre-active-learners';

interface CaseHeaderProps {
  learner: PreActiveLearner;
}

export function CaseHeader({ learner }: CaseHeaderProps) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      {/* Top row: name + programme + overall status */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <span className="text-primary-700 font-semibold text-lg">{learner.name.charAt(0)}</span>
          </div>
          <div>
            <h2 className="text-lg font-heading font-semibold text-foreground-900">{learner.name}</h2>
            <p className="text-[13px] text-foreground-500 mt-0.5">{learner.programme} &middot; {learner.standardCode}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[11px] text-foreground-400">ID: {learner.id}</span>
              <span className="text-[8px] text-foreground-300">&middot;</span>
              <span className="text-[11px] text-foreground-400">{learner.cohort}</span>
              <span className="text-[8px] text-foreground-300">&middot;</span>
              <span className="text-[11px] text-foreground-400">Target: {learner.targetStartDate || 'TBC'}</span>
            </div>
          </div>
        </div>
        <StatusPillGroup learner={learner} />
      </div>

      {/* Detail grid — 4 columns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <DetailItem label="Employer" value={learner.employer} icon="ri-building-2-line" />
        <DetailItem label="Line Manager" value={learner.lineManager} icon="ri-user-settings-line" />
        <DetailItem label="Current Stage" value={learner.currentStage} icon="ri-arrow-right-circle-line" highlight />
        <DetailItem label="Case Owner" value={learner.caseOwner} icon="ri-shield-user-line" />
        <DetailItem label="Compliance" value={learner.complianceStatus} icon="ri-shield-check-line" status={learner.complianceStatus} />
        <DetailItem label="Eligibility" value={learner.eligibilityStatus} icon="ri-checkbox-circle-line" status={learner.eligibilityStatus} />
        <DetailItem label="RPL" value={learner.rplStatus} icon="ri-bar-chart-line" status={learner.rplStatus} />
        <DetailItem label="DAS" value={learner.dasStatus} icon="ri-money-pound-circle-line" status={learner.dasStatus} />
        <DetailItem label="ILR" value={learner.ilrStatus} icon="ri-database-2-line" status={learner.ilrStatus} />
        <DetailItem label="Signatures" value={learner.signatureStatus} icon="ri-pen-nib-line" status={learner.signatureStatus} />
        <DetailItem label="QA" value={learner.qaStatus} icon="ri-shield-check-line" status={learner.qaStatus} />
        <DetailItem label="Risk" value={learner.riskStatus} icon="ri-alert-line" risk={learner.riskStatus} />
      </div>

      {/* Next action + audit trail */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-background-200/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200/50">
            <i className="ri-alert-line text-amber-600 text-sm"></i>
            <div>
              <p className="text-[11px] text-amber-800 font-medium">Next Action</p>
              <p className="text-[12px] text-amber-700">{learner.nextAction}</p>
            </div>
          </div>
          {learner.nextActionDue && (
            <span className="text-[11px] text-foreground-400 whitespace-nowrap">Due: <span className="font-medium text-foreground-600">{formatDate(learner.nextActionDue)}</span></span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-foreground-400">Updated: {formatDate(learner.lastUpdated)} ({learner.daysSinceLastUpdate}d ago)</span>
          <button className="flex items-center gap-1.5 text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
            <i className="ri-history-line"></i>
            Audit Trail
          </button>
        </div>
      </div>

      {learner.riskReason && (
        <div className="mt-3 px-3 py-2 bg-red-50 rounded-lg border border-red-200/50 flex items-start gap-2">
          <i className="ri-error-warning-line text-red-500 text-sm mt-0.5 shrink-0"></i>
          <p className="text-[12px] text-red-700">{learner.riskReason}</p>
        </div>
      )}
    </div>
  );
}

function StatusPillGroup({ learner }: { learner: PreActiveLearner }) {
  const overallConfig = getOverallStatusConfig(learner.overallStatus);
  return (
    <div className="flex flex-col items-end gap-2 shrink-0">
      <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${overallConfig.bg} ${overallConfig.text}`}>
        {learner.overallStatus}
      </span>
      <span className="text-[10px] text-foreground-400">Stage {learner.currentStageIndex + 1} of 15</span>
    </div>
  );
}

function DetailItem({ label, value, icon, highlight, status, risk }: {
  label: string; value: string; icon: string; highlight?: boolean; status?: string; risk?: string;
}) {
  let valueClass = 'text-[13px] text-foreground-700';

  if (highlight) {
    valueClass = 'text-[13px] text-primary-700 font-semibold';
  } else if (status) {
    const sc = getStatusColor(status);
    valueClass = `text-[13px] ${sc.text} font-medium`;
  } else if (risk) {
    const rc = getRiskColor(risk);
    valueClass = `text-[13px] ${rc} font-semibold`;
  }

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="w-6 h-6 rounded-md bg-background-100 flex items-center justify-center shrink-0 mt-0.5">
        <i className={`${icon} text-[11px] text-foreground-400`}></i>
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
    'Candidate': { bg: 'bg-background-100', text: 'text-foreground-500' },
    'Proceeding': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'Evidence Required': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'Employer In Review': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'No Show': { bg: 'bg-red-50', text: 'text-red-700' },
    'Awaiting Employer Signature': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'Ready for QA': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'Activation Pending': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  };
  return map[status] || { bg: 'bg-background-100', text: 'text-foreground-500' };
}

function getStatusColor(status: string): { bg: string; text: string } {
  if (/compliant|eligible|confirmed|ready|fully signed|approved|completed/i.test(status)) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-700' };
  }
  if (/pending|awaiting|in progress|partially|in review/i.test(status)) {
    return { bg: 'bg-amber-50', text: 'text-amber-700' };
  }
  if (/rejected|not eligible|invalid|overdue/i.test(status)) {
    return { bg: 'bg-red-50', text: 'text-red-700' };
  }
  return { bg: 'bg-background-100', text: 'text-foreground-400' };
}

function getRiskColor(risk: string): string {
  if (risk === 'Low') return 'text-emerald-600';
  if (risk === 'Medium') return 'text-amber-600';
  if (risk === 'High') return 'text-red-600';
  return 'text-foreground-400';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}