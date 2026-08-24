// ============================================================================
// Coaching delivery — MCR/MCM, Progress Review, Catch-up and Support, booked
// vs completed vs cancelled vs needing a schedule, for the selected month.
//
// This is the page's own categorisation (it does not exist anywhere else in
// the workspace), so the four-kind structure stays. What changes is that each
// kind card is now a `Panel` holding `StatusBadge`/`CompactMetric` for its
// counts and an `ActionRow` per item, instead of drawing its own borders,
// pills and hover states.
// ============================================================================
import { useMemo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ActionRow } from '@/components/ui/ActionRow';
import { CompactMetric } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDateLabel } from '@/pages/coach/shared/calendarEvents';
import { COACHING_DELIVERY_CONFIG, COACHING_DELIVERY_ORDER, COACHING_DELIVERY_STATUS_LABEL, COACHING_DELIVERY_STATUS_ORDER } from '../lib/constants';
import { formatNumber } from '../lib/monthly';
import { activityStatusTone, coachingDeliveryStatusTone } from '../lib/tone';
import type { CoachingDeliveryItem, CoachingDeliveryKind, CoachingDeliveryStatus, CoachingDeliverySummary } from '../types';

export function CoachingDeliveryPanel({
  delivery,
  monthLabel,
  onOpenCalendarItem,
}: {
  delivery: CoachingDeliverySummary;
  monthLabel: string;
  onOpenCalendarItem: (item: CoachingDeliveryItem) => void;
}) {
  const totalCaptured = useMemo(
    () => COACHING_DELIVERY_ORDER.reduce(
      (sum, kind) => sum + COACHING_DELIVERY_STATUS_ORDER.reduce((kindSum, status) => kindSum + delivery.byKind[kind].counts[status], 0),
      0,
    ),
    [delivery],
  );

  return (
    <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
      <SectionHeader
        icon="ri-user-voice-line"
        title={`MCR, PR, catch-up and support in ${monthLabel}`}
        description="Booked, completed, cancelled, and not-yet-scheduled sessions for the selected month."
        actions={<CompactMetric label="Captured sessions" value={formatNumber(totalCaptured)} />}
      />

      <div className="mt-4 grid items-start gap-3 xl:grid-cols-2">
        {COACHING_DELIVERY_ORDER.map((kind) => (
          <CoachingDeliveryKindCard
            key={kind}
            kind={kind}
            items={delivery.byKind[kind].items}
            counts={delivery.byKind[kind].counts}
            monthLabel={monthLabel}
            onOpenCalendarItem={onOpenCalendarItem}
          />
        ))}
      </div>
    </section>
  );
}

function CoachingDeliveryKindCard({
  kind,
  items,
  counts,
  monthLabel,
  onOpenCalendarItem,
}: {
  kind: CoachingDeliveryKind;
  items: CoachingDeliveryItem[];
  counts: Record<CoachingDeliveryStatus, number>;
  monthLabel: string;
  onOpenCalendarItem: (item: CoachingDeliveryItem) => void;
}) {
  const config = COACHING_DELIVERY_CONFIG[kind];
  const tone = activityStatusTone(config.tone);
  const total = COACHING_DELIVERY_STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge tone={tone} label={config.shortLabel} showIcon />
          <div>
            <h4 className="text-sm font-heading font-bold text-foreground-900">{config.label}</h4>
            <p className="mt-0.5 text-[12px] text-foreground-500">{formatNumber(total)} item{total === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        {COACHING_DELIVERY_STATUS_ORDER.map((status) => (
          <CompactMetric
            key={status}
            label={COACHING_DELIVERY_STATUS_LABEL[status]}
            value={formatNumber(counts[status])}
            tone={coachingDeliveryStatusTone(status)}
          />
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          size="sm"
          variant="empty"
          icon={config.icon}
          title="No activity captured"
          description={`No ${config.label.toLowerCase()} activity in ${monthLabel}.`}
          className="mt-3 rounded-lg border border-dashed border-foreground-200 bg-background-50"
        />
      ) : (
        <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <CoachingDeliveryRecentItem key={item.id} item={item} onOpenCalendarItem={onOpenCalendarItem} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function CoachingDeliveryRecentItem({
  item,
  onOpenCalendarItem,
}: {
  item: CoachingDeliveryItem;
  onOpenCalendarItem: (item: CoachingDeliveryItem) => void;
}) {
  return (
    <ActionRow
      title={item.learnerName}
      subtitle={item.title}
      status={<StatusBadge tone={coachingDeliveryStatusTone(item.status)} label={COACHING_DELIVERY_STATUS_LABEL[item.status]} />}
      meta={(
        <>
          <span className="text-[12px] text-foreground-400">{formatDateLabel(item.date)}</span>
          <span className="text-[12px] text-foreground-400">{item.timeLabel}</span>
        </>
      )}
      actions={<AppIcon className="ri-arrow-right-s-line text-lg text-foreground-300"></AppIcon>}
      tone={item.status === 'needs-schedule' ? 'caution' : 'neutral'}
      onClick={() => onOpenCalendarItem(item)}
      className="bg-background-100/60"
    />
  );
}
