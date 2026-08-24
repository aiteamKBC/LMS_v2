// ============================================================================
// Tabs / status filters.
//
// Seven idioms existed: `rounded-md` bordered pills, `rounded-lg` on a tinted
// track, `rounded-xl` bordered, `rounded-full`, an underline, and two different
// active colours (`primary-600` on four pages, `primary-900` on two, `#21003f`
// on two more). One now.
//
// Purple marks the active tab because that is interface state, which is exactly
// what the brand colour is reserved for. The count dot keeps its risk colour
// while idle and goes translucent white when selected, so the row never has two
// things claiming to be "the current one".
//
// A tab with a zero count can hide itself: an empty slice is not a filter worth
// offering, and six always-visible tabs where two are always zero is four tabs
// of signal and two of furniture.
// ============================================================================
import { memo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { toneStyle, type StatusTone } from '@/lib/statusTone';

export interface PageTabItem {
  value: string;
  label: string;
  /** Omit when the tab is not a count of anything. */
  count?: number;
  /** Tints the leading dot. Omit for no dot. */
  tone?: StatusTone;
  /** Hide when `count` is 0. */
  hideWhenEmpty?: boolean;
}

const ACTIVE_CLASS = 'border-primary-600 bg-primary-600 text-white';
const IDLE_CLASS = 'border-foreground-200 bg-background-50 text-foreground-600 hover:border-foreground-300 hover:text-foreground-900';

export const PageTabs = memo(function PageTabs({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: PageTabItem[];
  value: string;
  onChange: (next: string) => void;
  /** Accessible name for the group, e.g. "Filter learners by status". */
  label: string;
  className?: string;
}) {
  const visible = items.filter((item) => !item.hideWhenEmpty || (item.count ?? 0) > 0);

  return (
    <nav
      aria-label={label}
      className={cn('-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5', className)}
    >
      {visible.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold transition',
              active ? ACTIVE_CLASS : IDLE_CLASS,
            )}
          >
            {item.tone ? (
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  active ? 'bg-white/70' : toneStyle(item.tone).dot,
                )}
              ></span>
            ) : null}
            {item.label}
            {typeof item.count === 'number' ? (
              <span
                className={cn(
                  'inline-flex min-w-[20px] justify-center rounded px-1 py-0.5 text-[12px] font-bold tabular-nums',
                  active ? 'bg-white/20 text-white' : 'bg-background-100 text-foreground-500',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
});

/**
 * The tab strip's right-hand slot — a view toggle, an export button. Kept here
 * so the row's height and alignment are decided once.
 */
export function PageTabsBar({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
