// ============================================================================
// Monthly Cycle sidebar — Month Health, Action Queue, Latest Captured.
//
// Three small panels that used to each hand-roll a progress bar or a status
// dot. They now compose `Panel`, `ProgressBar` and `StatusDot` — the bars pick
// up the same positive/caution/critical palette every other coach page uses
// for these three risk bands.
// ============================================================================
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusDot } from '@/components/ui/StatusBadge';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import { activityStatusTone } from '../lib/tone';
import type { ActivityTone, MonthlyLearnerActivity, MonthlySummary } from '../types';

function HealthRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: StatusTone }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-semibold text-foreground-700">{label}</span>
        <span className="text-[13px] font-bold text-foreground-900">{value}</span>
      </div>
      <ProgressBar percent={percentage} tone={toneStyle(tone).dot} />
    </div>
  );
}

export function MonthSidebar({
  summary,
  learnersNeedingAction,
  latestActivities,
  monthLabel,
  onOpenLearner,
}: {
  summary: MonthlySummary;
  learnersNeedingAction: MonthlyLearnerActivity[];
  latestActivities: Array<{ id: string; learnerName: string; title: string; date: string; tone: ActivityTone }>;
  monthLabel: string;
  onOpenLearner: (learnerId: string) => void;
}) {
  return (
    <aside className="space-y-5">
      <Panel>
        <SectionHeader title="Month Health" />
        <div className="mt-4 space-y-3">
          <HealthRow label="On Track" value={summary.onTrack} total={summary.activeLearners} tone="positive" />
          <HealthRow label="Need Attention" value={summary.needAttention} total={summary.activeLearners} tone="caution" />
          <HealthRow label="Priority" value={summary.atRisk} total={summary.activeLearners} tone="critical" />
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          title="Action Queue"
          count={learnersNeedingAction.length}
        />
        {learnersNeedingAction.length === 0 ? (
          <EmptyState
            size="sm"
            variant="empty"
            icon="ri-check-double-line"
            title="No action gaps for this month."
          />
        ) : (
          <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
            {learnersNeedingAction.map((learner) => (
              <button
                key={learner.id}
                type="button"
                onClick={() => onOpenLearner(learner.id)}
                className="w-full text-left rounded-lg bg-background-100 hover:bg-background-200/60 border border-foreground-200/50 p-3 transition-smooth cursor-pointer"
              >
                <p className="text-[12px] font-bold text-foreground-900">{learner.name}</p>
                <p className="text-[12px] text-foreground-500 mt-1">{learner.needsAction[0]}</p>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader title="Latest Captured" />
        {latestActivities.length === 0 ? (
          <p className="text-[12px] text-foreground-400 mt-3">No captured activity yet for {monthLabel}.</p>
        ) : (
          <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
            {latestActivities.map((activity) => (
              <div key={`${activity.learnerName}-${activity.id}`} className="flex gap-3">
                <StatusDot tone={activityStatusTone(activity.tone)} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-foreground-900 truncate">{activity.learnerName}</p>
                  <p className="text-[12px] text-foreground-500 truncate">{activity.title}</p>
                  <p className="text-[12px] text-foreground-400">{formatDateLabel(activity.date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </aside>
  );
}
