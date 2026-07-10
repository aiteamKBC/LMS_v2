import type { EnrolmentReviewRecord } from '@/mocks/enrolment-review';

interface EnrolmentReviewHeaderProps {
  record: EnrolmentReviewRecord;
}

export function EnrolmentReviewHeader({ record }: EnrolmentReviewHeaderProps) {
  const statusConfig = getOverallStatusConfig(record.overallStatus);
  const scorePct = Math.round((record.checksCompleted / record.totalChecks) * 100);
  const passCount = record.checkItems.filter(c => c.result === 'pass').length;
  const failCount = record.checkItems.filter(c => c.result === 'fail').length;
  const unreviewedCount = record.checkItems.filter(c => c.result === 'not-reviewed').length;

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
              <span className="text-[11px] text-foreground-400">Target: {record.targetStartDate}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${statusConfig.bg} ${statusConfig.text}`}>
            {record.overallStatus}
          </span>
          <div className="flex items-center gap-2">
            <div className="w-28 h-2.5 bg-background-200 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-smooth" style={{ width: `${scorePct}%` }}></div>
            </div>
            <span className="text-[10px] text-foreground-400 whitespace-nowrap">{record.checksCompleted}/{record.totalChecks} checks</span>
          </div>
        </div>
      </div>

      {/* Review progress chips */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <span className="text-[12px] text-foreground-600">{passCount} pass</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
          <span className="text-[12px] text-foreground-600">{failCount} fail</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-background-300"></span>
          <span className="text-[12px] text-foreground-600">{unreviewedCount} unreviewed</span>
        </div>
        <span className="text-[10px] text-foreground-300 ml-1">|</span>
        <span className="text-[11px] text-foreground-400">Submitted: {formatDate(record.onboardingSubmittedDate)}</span>
        {record.reviewStartedDate && (
          <>
            <span className="text-[10px] text-foreground-300">&middot;</span>
            <span className="text-[11px] text-foreground-400">Review started: {formatDate(record.reviewStartedDate)}</span>
          </>
        )}
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <DetailItem label="Employer" value={record.employer} icon="ri-building-2-line" />
        <DetailItem label="Line Manager" value={record.lineManager} icon="ri-user-settings-line" />
        <DetailItem label="Reviewer" value={record.reviewerName} icon="ri-shield-user-line" highlight />
        <DetailItem label="Case Owner" value={record.caseOwner} icon="ri-user-received-line" />
        <DetailItem label="Risk" value={record.riskStatus} icon="ri-alert-line" risk={record.riskStatus} />
        <DetailItem label="Checks" value={`${passCount} pass / ${failCount} fail / ${unreviewedCount} pending`} icon="ri-checkbox-circle-line" />
        <DetailItem label="Missing Items" value={`${record.missingInformation.length} item${record.missingInformation.length !== 1 ? 's' : ''}`} icon="ri-error-warning-line" danger={record.missingInformation.length > 3} />
        <DetailItem label="Last Updated" value={`${formatDate(record.lastUpdated)} (${record.daysSinceLastUpdate}d ago)`} icon="ri-time-line" />
      </div>

      {/* Next action + audit */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-background-200/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200/50">
            <i className="ri-alert-line text-amber-600 text-sm"></i>
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
            <i className="ri-history-line"></i>
            Audit Trail
          </button>
        </div>
      </div>

      {record.riskReason && (
        <div className={`mt-3 px-3 py-2 rounded-lg border flex items-start gap-2 ${
          record.riskStatus === 'High' ? 'bg-red-50 border-red-200/50' : 'bg-amber-50 border-amber-200/50'
        }`}>
          <i className={record.riskStatus === 'High' ? 'ri-error-warning-line text-red-500' : 'ri-alert-line text-amber-500'}></i>
          <p className={`text-[12px] ${record.riskStatus === 'High' ? 'text-red-700' : 'text-amber-700'}`}>{record.riskReason}</p>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, icon, highlight, risk, danger }: {
  label: string; value: string; icon: string; highlight?: boolean; risk?: string; danger?: boolean;
}) {
  let valueClass = 'text-[13px] text-foreground-700';
  if (highlight) valueClass = 'text-[13px] text-primary-700 font-semibold';
  else if (risk) {
    const rc = risk === 'High' ? 'text-red-600' : risk === 'Medium' ? 'text-amber-600' : 'text-emerald-600';
    valueClass = `text-[13px] ${rc} font-semibold`;
  } else if (danger) {
    valueClass = 'text-[13px] text-red-600 font-semibold';
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
    'Submitted': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'Under Enrolment Review': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'Missing Information': { bg: 'bg-red-50', text: 'text-red-700' },
    'Returned to Learner': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'Ready for Eligibility Review': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'Rejected at Enrolment': { bg: 'bg-red-50', text: 'text-red-700' },
    'Escalated': { bg: 'bg-secondary-50', text: 'text-secondary-700' },
  };
  return map[status] || { bg: 'bg-background-100', text: 'text-foreground-500' };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}