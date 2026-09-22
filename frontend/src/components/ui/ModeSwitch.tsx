import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// ============================================================================
// A segmented two(-plus)-mode switch with a sliding indicator.
//
// The app's other "toggles" cross-fade a button's background; this one moves a
// single indicator between the segments (transform: translateX) so switching
// modes reads as a physical slide. The indicator lives inside the flex track and
// is exactly one segment wide, so translateX(index * 100%) lands it on each
// equal-width button with no per-item measuring. Animated with the shared
// `transition-smooth` easing (index.css).
// ============================================================================

export interface ModeSwitchOption {
  value: string;
  label: string;
  /** Optional leading icon (e.g. a lucide icon element). */
  icon?: ReactNode;
}

export function ModeSwitch({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  options: ModeSwitchOption[];
  /** Accessible name for the group, e.g. "Switch learning view". */
  label: string;
  className?: string;
}) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const width = `${100 / options.length}%`;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-full border border-foreground-200 bg-background-100 p-1', className)}
    >
      <div className="relative flex w-full">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-primary-500 shadow-sm shadow-primary-500/20 transition-smooth"
          style={{ width, transform: `translateX(${activeIndex * 100}%)` }}
        />
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[12px] font-semibold transition-smooth',
                active ? 'text-white' : 'text-foreground-500 hover:text-foreground-800',
              )}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
