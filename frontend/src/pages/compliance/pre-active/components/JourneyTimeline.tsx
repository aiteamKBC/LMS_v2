import type { PreActiveLearner } from '@/mocks/pre-active-learners';
import { PRE_ACTIVE_STAGES } from '@/mocks/pre-active-learners';

interface JourneyTimelineProps {
  learner: PreActiveLearner;
}

export function JourneyTimeline({ learner }: JourneyTimelineProps) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Journey Progress</h3>
        <span className="text-[11px] text-foreground-400">
          {learner.stageHistory.filter(s => s.status !== 'Not Started' && s.status !== 'N/A').length} of 15 stages complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-foreground-400 font-medium uppercase tracking-wider">Overall Progress</span>
          <span className="text-[11px] text-foreground-600 font-semibold">{getProgressPercent(learner)}%</span>
        </div>
        <div className="h-2 bg-background-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${getProgressPercent(learner)}%`,
              background: 'linear-gradient(90deg, oklch(var(--primary-400)), oklch(var(--primary-500)))',
            }}
          ></div>
        </div>
      </div>

      {/* Stage list */}
      <div className="space-y-0">
        {PRE_ACTIVE_STAGES.map((stage, idx) => {
          const historyEntry = learner.stageHistory.find(h => h.stageIndex === idx);
          const status = historyEntry?.status || 'Not Started';
          const isCurrent = learner.currentStageIndex === idx;
          const isCompleted = status !== 'Not Started' && status !== 'In Progress' && status !== 'N/A';
          const isInProgress = status === 'In Progress';

          return (
            <div key={stage.key} className="flex gap-3">
              {/* Connector line */}
              <div className="flex flex-col items-center shrink-0 w-7">
                <div className={`w-3 h-3 rounded-full shrink-0 mt-1.5 ${
                  isCompleted ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]' :
                  isInProgress ? 'bg-primary-500 shadow-[0_0_6px_rgba(var(--glow-purple)_/_0.3)]' :
                  isCurrent && status === 'N/A' ? 'bg-foreground-200' :
                  'bg-foreground-200'
                }`}></div>
                {idx < PRE_ACTIVE_STAGES.length - 1 && (
                  <div className={`w-0.5 flex-1 min-h-[16px] ${
                    isCompleted ? 'bg-emerald-300' :
                    isInProgress ? 'bg-primary-200' :
                    'bg-background-200'
                  }`}></div>
                )}
              </div>

              {/* Stage card */}
              <div className={`flex-1 pb-3 ${idx === PRE_ACTIVE_STAGES.length - 1 ? '' : ''}`}>
                <div className={`flex items-center gap-2.5 p-2.5 rounded-lg transition-smooth ${
                  isCurrent ? 'bg-primary-50/80 border border-primary-200/50' :
                  isCompleted ? 'bg-background-50' :
                  'bg-background-50/50'
                }`}>
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                    isCompleted ? 'bg-emerald-100 text-emerald-600' :
                    isInProgress ? 'bg-primary-100 text-primary-600' :
                    isCurrent && status === 'N/A' ? 'bg-background-100 text-foreground-300' :
                    'bg-background-100 text-foreground-400'
                  }`}>
                    <AppIcon className={`${stage.icon} text-xs`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground-900 truncate">{stage.label}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">Current</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StageStatusBadge status={status} />
                      {historyEntry?.completedDate && (
                        <>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] text-foreground-400">{formatDate(historyEntry.completedDate)}</span>
                        </>
                      )}
                      {historyEntry?.assignedTo && (
                        <>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] text-foreground-400 truncate">{historyEntry.assignedTo}</span>
                        </>
                      )}
                    </div>
                    {historyEntry?.notes && (
                      <p className="text-[11px] text-foreground-500 mt-1 leading-relaxed">{historyEntry.notes}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; icon: string }> = {
    'Completed': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'Induction Attended': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'Employer Contract Signed': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'Learner Submitted': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'Eligible': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'Pack Generated': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'Fully Signed': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'DAS Confirmed': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'ILR Ready': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'QA Approved': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-line' },
    'RPL Applied': { bg: 'bg-primary-50', text: 'text-primary-700', icon: 'ri-information-line' },
    'In Progress': { bg: 'bg-primary-50', text: 'text-primary-700', icon: 'ri-loader-4-line' },
    'Employer In Review': { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-time-line' },
    'Awaiting Employer Signature': { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-time-line' },
    'Partially Signed': { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-time-line' },
    'DAS Pending': { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-time-line' },
    'Candidate': { bg: 'bg-background-100', text: 'text-foreground-500', icon: 'ri-user-add-line' },
    'No Show': { bg: 'bg-red-50', text: 'text-red-700', icon: 'ri-close-circle-line' },
    'N/A': { bg: 'bg-background-50', text: 'text-foreground-300', icon: 'ri-checkbox-blank-circle-line' },
    'Not Started': { bg: 'bg-background-50', text: 'text-foreground-400', icon: 'ri-time-line' },
  };
  const c = config[status] || config['Not Started'];
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap ${c.bg} ${c.text}`}>
      <AppIcon className={`${c.icon} text-[9px]`}></AppIcon>
      {status}
    </span>
  );
}

function getProgressPercent(learner: PreActiveLearner): number {
  const completed = learner.stageHistory.filter(s =>
    s.status !== 'Not Started' && s.status !== 'N/A'
  ).length;
  return Math.round((completed / 15) * 100);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}