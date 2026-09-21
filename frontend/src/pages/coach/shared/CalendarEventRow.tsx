// ============================================================================
// The queue row shared by Coaching Meetings and Progress Reviews.
//
// Both pages are the same shape underneath — a `CoachCalendarEvent` that needs
// scheduling, running, and closing out — and their card markup had already
// converged on being character-for-character identical. This makes that
// intentional: one row, built on the workspace's `ActionRow`, with each page
// supplying only what genuinely differs (its meta chips and its actions).
// ============================================================================
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ActionRow } from '@/components/ui/ActionRow';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { statusTone, type StatusTone } from '@/lib/statusTone';
import { LearnerAvatar } from './LearnerIdentity';
import {
  type CoachCalendarEvent,
  isAtRiskEvent,
  isCancelledEvent,
  isCompletedEvent,
  isDueSoonEvent,
  isUrgentEvent,
  statusLabel,
} from './calendarEvents';

function avatarTone(event: CoachCalendarEvent): StatusTone {
  if (isCancelledEvent(event)) return 'critical';
  if (isCompletedEvent(event)) return 'positive';
  if (event.status === 'scheduled' || event.status === 'in-progress') return 'info';
  if (isUrgentEvent(event)) return 'caution';
  return 'neutral';
}

/** The rail colour: warning states are rose; active meeting states use the purple brand accent. */
function rowTone(event: CoachCalendarEvent): StatusTone {
  if (isAtRiskEvent(event)) return 'critical';
  if (isDueSoonEvent(event)) return 'caution';
  if (event.status === 'scheduled' || event.status === 'in-progress') return 'info';
  return 'neutral';
}

/** One fact chip in the row's meta strip — a date, a time, a platform, a cohort. */
export function CalendarEventMeta({ icon, children }: { icon: string; children: ReactNode }) {
  const tooltip = typeof children === 'string' ? children : undefined;

  return (
    <span className="ui-calendar-event-meta inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[12px] text-foreground-500">
      <AppIcon className={cn(icon, 'shrink-0 text-[13px] text-primary-500')}></AppIcon>
      <span className="min-w-0 truncate" title={tooltip}>{children}</span>
    </span>
  );
}

export function CalendarEventRow({
  event,
  isOpen,
  onToggle,
  meta,
  actions,
  subtitle,
  className,
  layout = 'row',
  children,
}: {
  event: CoachCalendarEvent;
  isOpen: boolean;
  onToggle: () => void;
  /** The date/time/platform facts for the collapsed row — built from `CalendarEventMeta`. */
  meta: ReactNode;
  /** The Join / Create slides / Schedule / Manage buttons for the collapsed row. */
  actions?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  /** Card mode exposes stable layout hooks while leaving existing queue rows unchanged. */
  layout?: 'row' | 'card';
  /** Expanded detail: schedule form, notes, signature panel. */
  children?: ReactNode;
}) {
  const disclosure = (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background-100 text-foreground-400 transition-transform',
        isOpen && 'rotate-180 bg-primary-50 text-primary-600',
      )}
    >
      <AppIcon className="ri-arrow-down-s-line"></AppIcon>
    </span>
  );

  return (
    <ActionRow
      tone={rowTone(event)}
      onClick={onToggle}
      className={cn(isOpen && 'z-20 border-primary-300 ring-1 ring-primary-100 xl:col-span-2', className)}
      leading={<LearnerAvatar name={event.learner} tone={avatarTone(event)} />}
      title={(
        <span className="block min-w-0 truncate" title={event.learner || 'Unknown learner'}>
          {event.learner || 'Unknown learner'}
        </span>
      )}
      subtitle={subtitle}
      status={(
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={statusTone(event.status)} label={statusLabel(event.status)} size="sm" />
          {isAtRiskEvent(event) ? <StatusBadge tone="critical" label="Overdue" dot={false} size="sm" /> : null}
          {isDueSoonEvent(event) ? <StatusBadge tone="upcoming" label="Due Soon" dot={false} size="sm" /> : null}
        </span>
      )}
      meta={meta}
      actions={layout === 'card' ? (
        <div className="ui-calendar-event-actions flex min-w-0 w-full flex-wrap items-start justify-between gap-2">
          <div className="ui-calendar-event-action-group flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {actions}
          </div>
          {disclosure}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {disclosure}
        </div>
      )}
    >
      {isOpen ? children : null}
    </ActionRow>
  );
}
