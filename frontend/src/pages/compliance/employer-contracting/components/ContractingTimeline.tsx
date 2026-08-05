import type { EmployerContractingRecord } from '@/mocks/employer-contracting';
import { CONTRACTING_STATUSES } from '@/mocks/employer-contracting';

interface ContractingTimelineProps {
  record: EmployerContractingRecord;
}

export function ContractingTimeline({ record }: ContractingTimelineProps) {
  const currentIndex = CONTRACTING_STATUSES.indexOf(record.currentStatus);

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">Status Timeline</h3>
      <p className="text-[11px] text-foreground-400 mb-5">Employer contracting journey from start to learner onboarding</p>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-foreground-400">
            {currentIndex >= 0 ? `Stage ${currentIndex + 1} of ${CONTRACTING_STATUSES.length}` : 'Not started'}
          </span>
          <span className="text-[11px] font-medium text-foreground-600">
            {currentIndex >= 0 ? Math.round(((currentIndex + 1) / CONTRACTING_STATUSES.length) * 100) : 0}%
          </span>
        </div>
        <div className="h-2 bg-background-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all duration-500"
            style={{ width: `${currentIndex >= 0 ? Math.round(((currentIndex + 1) / CONTRACTING_STATUSES.length) * 100) : 0}%` }}
          ></div>
        </div>
      </div>

      {/* Timeline items */}
      <div className="space-y-0">
        {CONTRACTING_STATUSES.map((status, idx) => {
          const historyEntry = record.statusHistory.find(h => h.status === status);
          const isCurrent = historyEntry?.isCurrent || false;
          const isPast = idx < currentIndex;
          const isFuture = idx > currentIndex;

          return (
            <div key={status} className="flex gap-3">
              {/* Connector line + dot */}
              <div className="flex flex-col items-center shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent ? 'border-primary-500 bg-primary-50' :
                  isPast ? 'border-emerald-400 bg-emerald-50' :
                  'border-background-200 bg-background-50'
                }`}>
                  {isPast ? (
                    <AppIcon className="ri-check-line text-emerald-500 text-xs"></AppIcon>
                  ) : isCurrent ? (
                    <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-foreground-200"></div>
                  )}
                </div>
                {idx < CONTRACTING_STATUSES.length - 1 && (
                  <div className={`w-0.5 flex-1 min-h-[20px] ${
                    isPast ? 'bg-emerald-200' : 'bg-background-200'
                  }`}></div>
                )}
              </div>

              {/* Content */}
              <div className={`pb-4 flex-1 min-w-0 ${idx === CONTRACTING_STATUSES.length - 1 ? 'pb-0' : ''}`}>
                <div className={`-mt-0.5 ${isFuture ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[13px] font-medium ${
                      isCurrent ? 'text-primary-700' : isPast ? 'text-foreground-800' : 'text-foreground-400'
                    }`}>{status}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-semibold text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded-full border border-primary-200/50 whitespace-nowrap">Current</span>
                    )}
                  </div>
                  {historyEntry?.date && (
                    <p className="text-[11px] text-foreground-400 mt-0.5">{formatDate(historyEntry.date)}</p>
                  )}
                  {historyEntry?.notes && (
                    <p className="text-[11px] text-foreground-500 mt-1 italic">{historyEntry.notes}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}