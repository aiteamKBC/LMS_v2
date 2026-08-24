// ============================================================================
// Learner month card.
//
// One learner's row in the Learner Month Log: identity, the monthly cycle
// headline numbers, and — expanded — the day-by-day timeline. This replaces
// the bespoke gradient card with a left accent rail; the card is now a plain
// `Panel`, identity is `LearnerIdentity`, and the four headline numbers are
// `CompactMetric` rather than a hand-rolled stat tile.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';
import { CompactMetric } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { statusTone } from '@/lib/statusTone';
import { LearnerIdentity } from '@/pages/coach/shared/LearnerIdentity';
import { MONTHLY_STATUS_LABEL } from '../lib/constants';
import { downloadLearnerMonthlyCyclePdf } from '../lib/pdf';
import { uniqueActivityDays } from '../lib/monthly';
import type { InlineActivityFilter, MonthlyLearnerActivity } from '../types';
import { LearnerMonthTimeline } from './LearnerMonthTimeline';

export function LearnerMonthCard({
  learner,
  monthLabel,
  monthKey,
  selected,
  expanded,
  inlineFilter,
  inlineSearch,
  onOpenOverview,
  onOpenCaseFile,
  onToggleTimeline,
  onInlineFilterChange,
  onInlineSearchChange,
}: {
  learner: MonthlyLearnerActivity;
  monthLabel: string;
  monthKey: string;
  selected: boolean;
  expanded: boolean;
  inlineFilter: InlineActivityFilter;
  inlineSearch: string;
  onOpenOverview: () => void;
  onOpenCaseFile: () => void;
  onToggleTimeline: () => void;
  onInlineFilterChange: (value: InlineActivityFilter) => void;
  onInlineSearchChange: (value: string) => void;
}) {
  const tone = statusTone(learner.status);

  return (
    <Panel
      padding="none"
      className={cn(selected && 'border-primary-300 ring-1 ring-primary-100')}
    >
      <div className="p-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <button type="button" onClick={onOpenOverview} className="flex-1 min-w-0 text-left">
            <LearnerIdentity
              name={learner.name}
              programme={`${learner.cohortName} - ${learner.group}`}
              tone={tone}
              size="lg"
              status={<StatusBadge tone={tone} label={MONTHLY_STATUS_LABEL[learner.status]} />}
            />
          </button>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button
              type="button"
              onClick={onOpenOverview}
              className="px-3 py-2 rounded-lg border border-primary-200 bg-primary-50 text-primary-700 text-[12px] font-semibold hover:bg-primary-100 transition-smooth cursor-pointer"
            >
              <AppIcon className="ri-layout-right-line mr-1.5"></AppIcon>
              Overview
            </button>
            <button
              type="button"
              onClick={onOpenCaseFile}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white text-[12px] font-semibold hover:bg-primary-700 transition-smooth cursor-pointer"
            >
              View File
            </button>
            <button
              type="button"
              onClick={onToggleTimeline}
              aria-label={expanded ? 'Collapse learner monthly cycle' : 'Open learner monthly cycle'}
              className="w-9 h-9 rounded-lg border border-foreground-200 text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer"
            >
              <AppIcon className={cn(expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line', 'text-lg')}></AppIcon>
            </button>
          </div>
        </div>

        <section className="mt-5 border-t border-foreground-100 pt-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-[12px] font-bold uppercase tracking-[0.12em] text-primary-700">
                <AppIcon className="ri-sparkling-2-line text-primary-600"></AppIcon>
                Learner monthly cycle
              </span>
              <h4 className="mt-3 text-lg font-heading font-bold text-foreground-900">{monthLabel} activity</h4>
              <p className="mt-1 text-sm text-foreground-500">Monthly activity summary and captured evidence.</p>
            </div>
            <button
              type="button"
              onClick={() => downloadLearnerMonthlyCyclePdf(learner, monthLabel, monthKey)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-primary-200 bg-white px-4 text-[12px] font-bold text-primary-700 shadow-sm transition-smooth hover:bg-primary-50 cursor-pointer"
            >
              <AppIcon className="ri-file-pdf-line text-sm"></AppIcon>
              Download PDF
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <CompactMetric label="Total events" value={learner.activities.length} tone="brand" />
            <CompactMetric label="Active days" value={uniqueActivityDays(learner.activities)} tone="positive" />
            <CompactMetric label="Time logged" value={learner.otjh.monthlyHoursLabel} tone="caution" />
            <CompactMetric label="KSBs evidenced" value={learner.ksb.touched} tone="brand" />
          </div>
        </section>
      </div>

      {expanded ? (
        <div className="border-t border-foreground-100 bg-background-100/40">
          <LearnerMonthTimeline
            learner={learner}
            monthLabel={monthLabel}
            filter={inlineFilter}
            query={inlineSearch}
            onFilterChange={onInlineFilterChange}
            onQueryChange={onInlineSearchChange}
          />
        </div>
      ) : null}
    </Panel>
  );
}
