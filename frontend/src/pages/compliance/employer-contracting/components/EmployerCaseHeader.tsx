import type { EmployerContractingRecord } from '@/mocks/employer-contracting';

interface EmployerCaseHeaderProps {
  record: EmployerContractingRecord;
}

export function EmployerCaseHeader({ record }: EmployerCaseHeaderProps) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      {/* Top row */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center shrink-0 border border-background-200/50">
            <AppIcon className="ri-building-2-line text-foreground-500 text-xl"></AppIcon>
          </div>
          <div>
            <h2 className="text-lg font-heading font-semibold text-foreground-900">{record.employerLegalName}</h2>
            {record.employerTradingName !== record.employerLegalName && (
              <p className="text-[12px] text-foreground-400 mt-0.5">Trading as: {record.employerTradingName}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[11px] text-foreground-400">{record.employerType}</span>
              {record.companyNumber && (
                <>
                  <span className="text-[8px] text-foreground-300">&middot;</span>
                  <span className="text-[11px] text-foreground-400">Co. No: {record.companyNumber}</span>
                </>
              )}
              <span className="text-[8px] text-foreground-300">&middot;</span>
              <span className="text-[11px] text-foreground-400">Learner: {record.learnerName}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusPill status={record.currentStatus} />
          <span className="text-[10px] text-foreground-400">Case: {record.id}</span>
        </div>
      </div>

      {/* Detail grid — 3 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <MiniDetail label="Learner" value={record.learnerName} />
        <MiniDetail label="Programme" value={record.programme + ' (' + record.standardCode + ')'} />
        <MiniDetail label="Cohort" value={record.cohort} />
        <MiniDetail label="Employer Contact" value={record.employerContactName || '—'} sub={record.employerContactEmail || ''} />
        <MiniDetail label="Signatory" value={record.employerSignatoryName || '—'} sub={record.employerSignatoryEmail || ''} />
        <MiniDetail label="Line Manager" value={record.lineManagerName} sub={record.lineManagerEmail} />
        <MiniDetail label="UK Address" value={record.ukAddress || '—'} />
        <MiniDetail label="Workplace Address" value={record.workplaceAddress || '—'} />
        <MiniDetail label="Workplace in England" value={record.workplaceInEngland ? 'Confirmed' : record.workplaceAddress ? 'Failed' : 'Pending'} highlight={record.workplaceInEngland ? 'good' : 'bad'} />
        <MiniDetail label="Job Title" value={record.learnerJobTitle || '—'} />
        <MiniDetail label="Employment" value={record.employmentStatus || '—'} sub={record.contractType ? `${record.contractType} · ${record.workingHours}h/wk` : ''} />
        <MiniDetail label="Working Pattern" value={record.normalWorkingPattern || '—'} />
        <MiniDetail label="PAYE Confirmed" value={record.payeConfirmed ? 'Yes' : record.currentStatus === 'Employer Details Required' ? 'Pending' : 'No'} highlight={record.payeConfirmed ? 'good' : 'bad'} />
        <MiniDetail label="DAS Account" value={record.dasAccountStatus} sub={record.providerAddedToDas ? 'Provider added' : 'Provider not added'} />
        <MiniDetail label="Funding Route" value={record.fundingRoute || '—'} sub={record.levyStatus || ''} />
        {record.coInvestmentRequired && (
          <MiniDetail label="Co-investment" value={'£' + (record.coInvestmentAmount || 0).toLocaleString()} highlight="warn" />
        )}
      </div>

      {/* Commitments row */}
      <div className="mt-4 pt-4 border-t border-background-200/50">
        <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium mb-2">Commitments &amp; Declarations</p>
        <div className="flex flex-wrap gap-2">
          <CommitmentChip label="Employer Commitment" done={record.employerCommitmentSigned} />
          <CommitmentChip label="Contract for Services" done={record.contractForServicesSigned} />
          <CommitmentChip label="Workplace Validation" done={record.workplaceValidationCompleted} />
          <CommitmentChip label="Employer Declaration" done={record.employerDeclarationSigned} />
          <CommitmentChip label="Health &amp; Safety" done={record.healthAndSafetyConfirmed} />
          <CommitmentChip label="Employer Support" done={record.employerSupportConfirmed} />
          <CommitmentChip label="OTJH Paid Hours" done={record.otjhPaidHoursConfirmed} />
          <CommitmentChip label="Progress Reviews" done={record.progressReviewCommitmentConfirmed} />
          <CommitmentChip label="Data Sharing" done={record.dataSharingConfirmed} />
        </div>
      </div>

      {/* Next action + meta */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-background-200/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200/50">
            <AppIcon className="ri-alert-line text-amber-600 text-sm"></AppIcon>
            <div>
              <p className="text-[11px] text-amber-800 font-medium">Next Action</p>
              <p className="text-[12px] text-amber-700">{record.nextAction}</p>
            </div>
          </div>
          {record.nextActionDue && (
            <span className="text-[11px] text-foreground-400 whitespace-nowrap">Due: <span className="font-medium text-foreground-600">{formatDate(record.nextActionDue)}</span></span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-foreground-400">Updated: {formatDate(record.lastUpdated)} ({record.daysSinceLastUpdate}d ago)</span>
          <span className="text-[11px] text-foreground-400">Owner: {record.caseOwner}</span>
        </div>
      </div>

      {/* Risk reason */}
      {record.riskReason && (
        <div className="mt-3 px-3 py-2 bg-red-50 rounded-lg border border-red-200/50 flex items-start gap-2">
          <AppIcon className="ri-error-warning-line text-red-500 text-sm mt-0.5 shrink-0"></AppIcon>
          <p className="text-[12px] text-red-700">{record.riskReason}</p>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const config = getStatusPillConfig(status);
  return (
    <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${config.bg} ${config.text}`}>
      {status}
    </span>
  );
}

function getStatusPillConfig(status: string): { bg: string; text: string } {
  if (/signed|ready/i.test(status) && !/awaiting/i.test(status)) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-700' };
  }
  if (/sent|awaiting|in review/i.test(status)) {
    return { bg: 'bg-amber-50', text: 'text-amber-700' };
  }
  if (/required|missing|failed|invalid|action required/i.test(status)) {
    return { bg: 'bg-red-50', text: 'text-red-700' };
  }
  return { bg: 'bg-background-100', text: 'text-foreground-500' };
}

function MiniDetail({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'good' | 'bad' | 'warn' }) {
  let valueClass = 'text-[13px] text-foreground-700';
  if (highlight === 'good') valueClass = 'text-[13px] text-emerald-700 font-medium';
  else if (highlight === 'bad') valueClass = 'text-[13px] text-red-600 font-medium';
  else if (highlight === 'warn') valueClass = 'text-[13px] text-amber-700 font-medium';

  return (
    <div className="min-w-0">
      <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium">{label}</p>
      <p className={valueClass + ' truncate'} title={value}>{value}</p>
      {sub && <p className="text-[11px] text-foreground-400 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

function CommitmentChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${
      done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-background-100 text-foreground-400 border border-background-200/50'
    }`}>
      <AppIcon className={`${done ? 'ri-check-line text-emerald-500' : 'ri-time-line text-foreground-300'} text-[10px]`}></AppIcon>
      {label}
    </span>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}