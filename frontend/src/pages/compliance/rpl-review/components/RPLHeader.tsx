import type { RPLRecord } from '@/mocks/rpl-review';

interface RPLHeaderProps {
  record: RPLRecord;
}

export function RPLHeader({ record }: RPLHeaderProps) {
  const statusConfig = getOverallStatusConfig(record.overallStatus);
  const decisionConfig = getRPLOutcomeConfig(record.rplDecision.outcome);
  const rplPct = record.rplDecision.rplPercentage;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
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
          {record.rplDecision.outcome !== 'pending' && (
            <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${decisionConfig.bg} ${decisionConfig.text}`}>
              <AppIcon className={`${decisionConfig.icon} text-[10px] mr-1`}></AppIcon>
              {rplPct}% RPL
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <QuickStat label="KSB Categories" value={`${record.ksbCategories.length} mapped`} icon="ri-links-line" />
        <QuickStat label="Total RPL" value={record.rplDecision.totalKSBRPL > 0 ? `${record.rplDecision.totalKSBRPL}/${record.rplDecision.totalKSBCount} KSBs` : 'Not assessed'} icon="ri-checkbox-circle-line" />
        <QuickStat label="Duration Reduction" value={record.durationReduction.rplReduction > 0 ? `${record.durationReduction.rplReduction} months` : 'None yet'} icon="ri-time-line" />
        <QuickStat label="Adjusted Duration" value={record.durationReduction.rplReduction > 0 ? `${record.durationReduction.adjustedDuration} months` : `${record.durationReduction.standardDuration} months`} icon="ri-calendar-line" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <DetailItem label="Employer" value={record.employer} icon="ri-building-2-line" />
        <DetailItem label="Line Manager" value={record.lineManager} icon="ri-user-settings-line" />
        <DetailItem label="Assessor" value={record.assessor} icon="ri-shield-user-line" highlight />
        <DetailItem label="Risk" value={record.riskStatus} icon="ri-alert-line" risk={record.riskStatus} />
      </div>

      {record.priorQualificationsSummary && (
        <div className="px-4 py-3 rounded-lg border border-background-200/50 bg-background-50 mb-4">
          <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-1">Prior Qualifications</p>
          <p className="text-[12px] text-foreground-600 leading-relaxed">{record.priorQualificationsSummary}</p>
        </div>
      )}

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
      </div>

      {record.riskReason && (
        <div className={`mt-3 px-3 py-2 rounded-lg border flex items-start gap-2 ${record.riskStatus === 'High' ? 'bg-red-50 border-red-200/50' : 'bg-amber-50 border-amber-200/50'}`}>
          <AppIcon className={record.riskStatus === 'High' ? 'ri-error-warning-line text-red-500' : 'ri-alert-line text-amber-500'}></AppIcon>
          <p className={`text-[12px] ${record.riskStatus === 'High' ? 'text-red-700' : 'text-amber-700'}`}>{record.riskReason}</p>
        </div>
      )}
    </div>
  );
}

function QuickStat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-background-50 border border-background-200/40">
      <span className="w-7 h-7 rounded-md bg-background-100 flex items-center justify-center shrink-0">
        <AppIcon className={`${icon} text-[11px] text-foreground-400`}></AppIcon>
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
    'Not Started': { bg: 'bg-background-100', text: 'text-foreground-500' },
    'Evidence Collection': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'RPL In Progress': { bg: 'bg-primary-50', text: 'text-primary-700' },
    'RPL Applied': { bg: 'bg-amber-50', text: 'text-amber-700' },
    'RPL Approved': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'RPL Rejected': { bg: 'bg-red-50', text: 'text-red-700' },
    'Makes Learner Ineligible': { bg: 'bg-red-50', text: 'text-red-700' },
    'Escalated': { bg: 'bg-secondary-50', text: 'text-secondary-700' },
  };
  return map[status] || { bg: 'bg-background-100', text: 'text-foreground-500' };
}

function getRPLOutcomeConfig(outcome: string): { bg: string; text: string; icon: string } {
  const map: Record<string, { bg: string; text: string; icon: string }> = {
    'approved': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'partial-approved': { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-check-double-line' },
    'rejected': { bg: 'bg-red-50', text: 'text-red-700', icon: 'ri-close-line' },
    'pending': { bg: 'bg-background-100', text: 'text-foreground-500', icon: 'ri-time-line' },
  };
  return map[outcome] || { bg: 'bg-background-100', text: 'text-foreground-500', icon: 'ri-time-line' };
}