// ============================================================================
// Learner overview drawer content.
//
// Opened from the learner card's "Overview" button. Was a `rounded-3xl`
// gradient hero plus five more hand-rolled cards; now `Panel` throughout, with
// `LearnerIdentity`, `CompactMetric`, `ProgressMetric` and the shared
// `ActivityRow` doing the presentation.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';
import { CompactMetric } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { ProgressMetric } from '@/components/ui/ProgressMetric';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusTone } from '@/lib/statusTone';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import { MONTHLY_STATUS_LABEL } from '../lib/constants';
import { formatHoursLabel, uniqueActivityDays } from '../lib/monthly';
import type { MonthlyLearnerActivity } from '../types';
import { ActivityRow } from './ActivityRow';

export function LearnerOverviewPanel({
  learner,
  monthLabel,
  isExporting,
  onExport,
}: {
  learner: MonthlyLearnerActivity;
  monthLabel: string;
  isExporting: boolean;
  onExport: () => void;
}) {
  const tone = statusTone(learner.status);
  const coachingCoverage = learner.coaching.total > 0
    ? Math.round((learner.coaching.booked / learner.coaching.total) * 100)
    : learner.coaching.needsSchedule > 0 ? 0 : 100;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <LearnerIdentity
            name={learner.name}
            programme={learner.programme || '--'}
            tone={tone}
            size="lg"
            status={<StatusBadge tone={tone} label={MONTHLY_STATUS_LABEL[learner.status]} />}
            meta={`${learner.cohortName} - ${learner.group}`}
          />
          <button
            type="button"
            onClick={onExport}
            disabled={isExporting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-[12px] font-semibold text-white hover:bg-red-700 transition-smooth cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed sm:ml-auto"
          >
            <AppIcon className={isExporting ? 'ri-loader-4-line animate-spin text-sm' : 'ri-file-pdf-line text-sm'}></AppIcon>
            {isExporting ? 'Preparing PDF...' : 'Download PDF'}
          </button>
        </div>
        <p className="text-[12px] text-foreground-500 mt-3">Monthly cycle snapshot for {monthLabel}</p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <CompactMetric
            label="Last captured"
            value={learner.lastActivityLabel}
            note={learner.lastActivityDate ? formatDateLabel(learner.lastActivityDate) : 'No date captured'}
          />
          <CompactMetric
            label="OTJH status"
            value={learner.otjhStatus}
            note={`${learner.activities.length} captured item${learner.activities.length === 1 ? '' : 's'}`}
          />
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          icon="ri-sparkling-2-line"
          title={`${monthLabel} activity`}
          description="Same headline numbers shown on the learner card."
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <CompactMetric label="Total events" value={learner.activities.length} tone="brand" />
          <CompactMetric label="Active days" value={uniqueActivityDays(learner.activities)} tone="positive" />
          <CompactMetric label="Time logged" value={learner.otjh.monthlyHoursLabel} tone="caution" />
          <CompactMetric label="KSBs evidenced" value={learner.ksb.touched} tone="brand" />
        </div>
      </Panel>

      <Panel>
        <div className="flex items-start justify-between gap-3">
          <SectionHeader
            title="Month Health"
            description="Quick read on logged hours and coaching coverage for the selected month."
          />
          <StatusBadge tone={tone} label={MONTHLY_STATUS_LABEL[learner.status]} />
        </div>
        <div className="space-y-4 mt-4">
          <ProgressMetric
            label="OTJH monthly target"
            value={`${learner.otjh.progress}%`}
            percent={learner.otjh.progress}
            note={`${learner.otjh.monthlyHoursLabel} logged of ${formatHoursLabel(learner.otjh.monthlyTarget)}`}
          />
          <ProgressMetric
            label="Coaching coverage"
            value={`${coachingCoverage}%`}
            percent={coachingCoverage}
            note={`${learner.coaching.booked} booked - ${learner.coaching.total} total touchpoints`}
          />
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Action Flags" description="Anything needing follow-up for this learner this month." />
        {learner.needsAction.length === 0 ? (
          <EmptyState size="sm" variant="empty" icon="ri-check-double-line" title="No action gaps recorded." />
        ) : (
          <div className="flex flex-wrap gap-2 mt-4">
            {learner.needsAction.map((action) => (
              <StatusBadge key={action} tone={tone} label={action} dot={false} />
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader
          title="Activity Timeline"
          description={`${learner.activities.length} captured item${learner.activities.length === 1 ? '' : 's'} in ${monthLabel}`}
          actions={<span className="text-[12px] font-semibold text-foreground-400 uppercase tracking-wide">{learner.otjhStatus}</span>}
        />

        {learner.activities.length === 0 ? (
          <EmptyState
            size="sm"
            variant="empty"
            icon="ri-inbox-line"
            title={`No activity captured for ${monthLabel}`}
            description="This learner has no progress log, activity feed, or coach calendar item in the selected month."
          />
        ) : (
          <div className="space-y-3 mt-4">
            {learner.activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
