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
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
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
      <div className="flex flex-col gap-3 border-b border-foreground-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeader
          icon="ri-user-voice-line"
          title={`Monthly delivery in ${monthLabel}`}
          description="MCR/MCM, progress reviews, catch-ups and support sessions for the selected month."
          className="mb-0"
        />
        <div className="inline-flex w-fit items-center gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-2.5 text-primary-800">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-primary-700 shadow-sm">
            <AppIcon className="ri-calendar-check-line text-base"></AppIcon>
          </span>
          <span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-primary-500">Captured sessions</span>
            <span className="block text-xl font-bold leading-none tabular-nums">{formatNumber(totalCaptured)}</span>
          </span>
        </div>
      </div>

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
  const style = toneStyle(tone);
  const total = COACHING_DELIVERY_STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);

  return (
    <Panel className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.bg} ${style.text}`}>
            <AppIcon className={`${config.icon} text-lg`}></AppIcon>
          </span>
          <div>
            <h4 className="text-sm font-heading font-bold text-foreground-900">{config.label}</h4>
            <p className="mt-0.5 text-[12px] text-foreground-500">{config.shortLabel} sessions this month</p>
          </div>
        </div>
        <StatusBadge tone={tone} label={`${formatNumber(total)} item${total === 1 ? '' : 's'}`} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COACHING_DELIVERY_STATUS_ORDER.map((status) => (
          <DeliveryStatusStat
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
          className="mt-4 min-h-[118px] rounded-xl border border-dashed border-foreground-200 bg-background-100/40 py-5"
        />
      ) : (
        <div className="mt-4 max-h-[340px] space-y-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <CoachingDeliveryRecentItem key={item.id} item={item} onOpenCalendarItem={onOpenCalendarItem} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function DeliveryStatusStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: StatusTone;
}) {
  const style = toneStyle(tone);

  return (
    <div className="rounded-xl border border-foreground-100 bg-background-100/60 px-3 py-2.5">
      <p className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-foreground-400">{label}</p>
      <p className={`mt-1 text-lg font-bold leading-none tabular-nums ${tone === 'neutral' ? 'text-foreground-900' : style.text}`}>
        {value}
      </p>
    </div>
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
          <span className="inline-flex items-center gap-1 text-[12px] text-foreground-500">
            <AppIcon className="ri-calendar-line text-primary-500"></AppIcon>
            {formatDateLabel(item.date)}
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] text-foreground-500">
            <AppIcon className="ri-time-line text-primary-500"></AppIcon>
            {item.timeLabel}
          </span>
        </>
      )}
      actions={<AppIcon className="ri-arrow-right-s-line text-lg text-foreground-300"></AppIcon>}
      tone={item.status === 'needs-schedule' ? 'caution' : 'neutral'}
      onClick={() => onOpenCalendarItem(item)}
      className="bg-background-100/60"
    />
  );
}
