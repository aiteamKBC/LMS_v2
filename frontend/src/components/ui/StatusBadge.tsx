// ============================================================================
// Status badge.
//
// One component, replacing nineteen colour-mapping functions. Colour is carried
// here rather than by the callers, which is what stops the same signal being
// green on one screen and amber on the next.
//
// Two ways in:
//   <StatusBadge status={row.status} />        — resolves the tone from the API string
//   <StatusBadge tone="critical" label="…" />  — when the caller already knows
//
// The dot is not decoration: it is what makes the badge readable to someone who
// cannot separate the amber fill from the red one.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { EMPTY_VALUE, displayValue } from '@/lib/format';
import { statusTone, toneStyle, type StatusTone } from '@/lib/statusTone';

const SIZE_CLASS = {
  sm: 'px-1.5 py-0.5 text-[12px] gap-1',
  md: 'px-2 py-0.5 text-[12px] gap-1.5',
  lg: 'px-2.5 py-1 text-[13px] gap-1.5',
} as const;

export const StatusBadge = memo(function StatusBadge({
  status,
  tone,
  label,
  size = 'md',
  dot = true,
  showIcon = false,
  className,
}: {
  /** Raw status from the API. Ignored when `tone` is given. */
  status?: string | null;
  /** Explicit tone, when the caller has already decided. */
  tone?: StatusTone;
  /** Overrides the label. Defaults to the tidied `status` string. */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  showIcon?: boolean;
  className?: string;
}) {
  const text = label ?? displayValue(status);
  if (text === EMPTY_VALUE) return null;

  const style = toneStyle(tone ?? statusTone(status));

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-md border font-semibold',
        style.bg,
        style.border,
        style.text,
        SIZE_CLASS[size],
        className,
      )}
    >
      {showIcon ? (
        <AppIcon className={cn(style.icon, 'text-[13px]')}></AppIcon>
      ) : dot ? (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)}></span>
      ) : null}
      {text}
    </span>
  );
});

/**
 * A bare tone dot, for tables dense enough that a full badge in every row is
 * noise. The accessible name has to come from the cell around it.
 */
export const StatusDot = memo(function StatusDot({
  status,
  tone,
  className,
}: {
  status?: string | null;
  tone?: StatusTone;
  className?: string;
}) {
  const style = toneStyle(tone ?? statusTone(status));
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', style.dot, className)}></span>;
});
