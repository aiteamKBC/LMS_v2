// ============================================================================
// KPI hierarchy — two tiers, deliberately.
//
// Sixteen separate stat-tile components existed across the coach workspace, and
// several pages rendered eight of them at equal weight. Eight equally loud
// numbers is the same as none: nothing is the answer to "what do I do now".
//
// So: MetricCard for the three or four figures that drive a decision, and
// CompactMetric for the supporting ones. If a page needs more than four
// MetricCards, the page has not decided what it is for.
//
// `tone` accents the number, never the whole card. A wall of tinted cards makes
// every metric look urgent, which is how the amber ones stopped being read.
// ============================================================================
import { memo, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { toneStyle, type StatusTone } from '@/lib/statusTone';

export const MetricCard = memo(function MetricCard({
  label,
  value,
  note,
  tone = 'neutral',
  icon,
  onClick,
  active = false,
  className,
}: {
  label: string;
  value: string | number;
  /** The interpretation — "4 overdue", "12.8 hrs behind". This is the point. */
  note?: ReactNode;
  tone?: StatusTone;
  /** Remix icon class. */
  icon?: string;
  /** Given when the card filters the view below it. */
  onClick?: () => void;
  /** True when this card's filter is the one currently applied. */
  active?: boolean;
  className?: string;
}) {
  const style = toneStyle(tone);
  const neutral = tone === 'neutral';

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-400">
          {label}
        </p>
        {icon ? (
          <AppIcon className={cn(icon, 'shrink-0 text-[15px]', neutral ? 'text-foreground-300' : style.text)}></AppIcon>
        ) : null}
      </div>

      <p
        className={cn(
          'mt-1.5 text-[28px] font-semibold leading-none tabular-nums',
          neutral ? 'text-foreground-900' : style.text,
        )}
      >
        {value}
      </p>

      {note ? (
        <p className="mt-1.5 text-[12px] leading-snug text-foreground-500">{note}</p>
      ) : null}
    </>
  );

  const surface = cn(
    'rounded-2xl border bg-background-50 p-4 text-left shadow-sm',
    active ? 'border-primary-400 ring-1 ring-primary-200' : 'border-foreground-200/70',
    className,
  );

  if (!onClick) {
    return <div className={surface}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(surface, 'transition hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300')}
    >
      {body}
    </button>
  );
});

/**
 * The secondary tier. Sits in a divided row rather than in its own card, because
 * a card around a single small number is the "cards inside cards" problem in
 * miniature.
 */
export const CompactMetric = memo(function CompactMetric({
  label,
  value,
  note,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string | number;
  note?: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  const style = toneStyle(tone);

  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-foreground-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-[18px] font-semibold leading-tight tabular-nums',
          tone === 'neutral' ? 'text-foreground-900' : style.text,
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">{note}</p> : null}
    </div>
  );
});

/**
 * A row of CompactMetrics separated by rules rather than by card borders. This
 * is the replacement for a grid of eight small cards.
 */
export function MetricRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-5 gap-y-4 rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
