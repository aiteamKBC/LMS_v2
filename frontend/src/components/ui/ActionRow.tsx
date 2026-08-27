// ============================================================================
// Queue row.
//
// The shared row for the four screens that are work queues rather than
// dashboards: Marking, Absence Reports, Coaching Meetings, Progress Reviews.
// Each had its own expandable <article> card with its own padding, its own
// avatar treatment and its own action placement.
//
// The row's job is to make the next action obvious. So the action sits at the
// end of the row on one axis with everything a coach needs to decide it — who,
// what, when, how bad — and nothing else.
//
// Urgency is a 3px left rail, not a tinted card. A page of tinted cards reads as
// uniformly alarming, which is how "overdue" stopped standing out on the pages
// that did that.
// ============================================================================
import type { ReactNode } from 'react';
// Imported explicitly rather than relying on the auto-import plugin, which only
// runs in the app build — these rows are rendered by page tests too.
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { toneStyle, type StatusTone } from '@/lib/statusTone';

export function ActionRow({
  leading,
  title,
  subtitle,
  meta,
  status,
  actions,
  tone = 'neutral',
  onClick,
  children,
  className,
}: {
  /** Usually a LearnerIdentity avatar or an icon well. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The facts that decide the action — dates, counts, reasons. */
  meta?: ReactNode;
  /** A StatusBadge, typically. */
  status?: ReactNode;
  /** The next action. Rightmost, so the eye lands on it last. */
  actions?: ReactNode;
  /** Draws a left rail when not neutral. Reserve it for genuine urgency. */
  tone?: StatusTone;
  onClick?: () => void;
  /** Expanded detail, revealed below the row. */
  children?: ReactNode;
  className?: string;
}) {
  const railed = tone !== 'neutral';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-background-50 shadow-sm',
        className,
      )}
    >
      {railed ? (
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 w-[3px]', toneStyle(tone).dot)}
        ></span>
      ) : null}

      <div
        onClick={onClick}
        className={cn(
          'flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center',
          railed && 'pl-5',
          onClick && 'cursor-pointer transition-colors hover:bg-primary-50/30',
        )}
      >
        {leading ? <div className="shrink-0">{leading}</div> : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-[14px] font-semibold text-foreground-900">{title}</p>
            {status}
          </div>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[12px] text-foreground-500">{subtitle}</p>
          ) : null}
        </div>

        {meta ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:shrink-0">{meta}</div>
        ) : null}

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {children ? (
        <div className="border-t border-foreground-100 bg-background-100/40 px-4 py-3.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The primary button inside a queue row. Here so "Schedule" looks the same on
 * Coaching Meetings as it does on Progress Reviews — the two pages had different
 * heights, radii and shades for the identical action.
 */
export function RowAction({
  label,
  icon,
  onClick,
  emphasis = 'secondary',
  disabled = false,
}: {
  label: string;
  icon?: string;
  onClick: () => void;
  emphasis?: 'primary' | 'secondary' | 'meeting';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        emphasis === 'meeting'
          ? 'meeting-join-action'
          : emphasis === 'primary'
            ? 'bg-primary-600 text-white hover:bg-primary-700'
            : 'border border-foreground-200 bg-background-50 text-foreground-700 hover:border-foreground-300 hover:text-foreground-900',
      )}
    >
      {icon ? <AppIcon className={icon}></AppIcon> : null}
      {label}
    </button>
  );
}
