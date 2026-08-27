// ============================================================================
// Search and filter toolbar.
//
// One layout, one control height (h-9), one radius. Before this there were three
// separate `FilterDropdown` components, six different search-input treatments,
// and two pages that wrote out their active-filter chips by hand — six verbatim
// copies of the same span on one page alone.
//
// The layout the brief asks for:
//
//   [ Search........................ ] [ filters ]        [ sort ] [ view ]
//
// Applied filters are echoed back as removable chips below the row. That matters
// more than it sounds: the commonest "the page is broken" report on screens like
// these is a filter someone forgot was on.
// ============================================================================
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';

export interface FilterOption {
  value: string;
  label: string;
}

// --- toolbar shell ----------------------------------------------------------

export function FilterToolbar({
  search,
  filters,
  trailing,
  chips,
  className,
}: {
  /** The SearchInput. Grows to fill the row. */
  search?: ReactNode;
  /** Primary filter controls, left-aligned after the search. */
  filters?: ReactNode;
  /** Sort and view controls, pushed to the right. */
  trailing?: ReactNode;
  /** Active-filter chips, shown on their own row when present. */
  chips?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-background-50 p-3 shadow-sm',
        className,
      )}
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        {search ? <div className="min-w-0 lg:max-w-sm lg:flex-1">{search}</div> : null}
        {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
        {trailing ? (
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{trailing}</div>
        ) : null}
      </div>

      {chips ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-foreground-100 pt-2.5">
          {chips}
        </div>
      ) : null}
    </div>
  );
}

// --- search -----------------------------------------------------------------

export const SearchInput = memo(function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400"></AppIcon>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className="h-9 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-8 text-[13px] text-foreground-900 placeholder:text-foreground-400 transition hover:border-foreground-300 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200/50"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-foreground-400 transition hover:bg-background-100 hover:text-foreground-700"
        >
          <AppIcon className="ri-close-line text-[13px]"></AppIcon>
        </button>
      ) : null}
    </div>
  );
});

// --- select -----------------------------------------------------------------

/**
 * The filter dropdown. Behaviour carried over from the caseload toolbar so it
 * keeps doing what coaches already expect: click outside to dismiss, Escape to
 * close, a check on the current value.
 *
 * `tone="active"` tints the trigger when the filter is doing something, which is
 * the cheapest way to make an accidentally-applied filter visible.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  label,
  icon,
  align = 'left',
  widthClass = 'w-auto',
  tone = 'default',
}: {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Shown before the value, e.g. "Sort". Omit to show the value alone. */
  label?: string;
  icon?: string;
  align?: 'left' | 'right';
  widthClass?: string;
  tone?: 'default' | 'active';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const isActive = tone === 'active';

  return (
    <div ref={rootRef} className={cn('relative', widthClass)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center gap-1.5 rounded-lg border px-2.5 text-left text-[13px] font-medium transition',
          isActive
            ? 'border-primary-300 bg-primary-50 text-primary-800'
            : open
              ? 'border-primary-300 bg-background-50 text-foreground-900'
              : 'border-foreground-200 bg-background-50 text-foreground-700 hover:border-foreground-300',
        )}
      >
        {icon ? <AppIcon className={cn(icon, 'shrink-0 text-[14px] text-foreground-400')}></AppIcon> : null}
        {label ? <span className="shrink-0 text-foreground-400">{label}</span> : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <AppIcon
          className={cn(
            'ri-arrow-down-s-line shrink-0 text-[15px] text-foreground-400 transition-transform',
            open && 'rotate-180',
          )}
        ></AppIcon>
      </button>

      {open ? (
        <div
          role="listbox"
          className={cn(
            'absolute top-[calc(100%+4px)] z-50 max-h-72 w-max min-w-full overflow-y-auto rounded-lg border border-foreground-200 bg-background-50 p-1 shadow-panel',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 whitespace-nowrap rounded px-2.5 py-1.5 text-left text-[13px] transition',
                  active
                    ? 'bg-primary-50 font-semibold text-primary-800'
                    : 'text-foreground-700 hover:bg-background-100',
                )}
              >
                <span className="max-w-[280px] flex-1 truncate">{option.label}</span>
                {active ? <AppIcon className="ri-check-line text-[14px]"></AppIcon> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// --- chips ------------------------------------------------------------------

export const FilterChip = memo(function FilterChip({
  label,
  value,
  onRemove,
}: {
  /** The dimension, e.g. "Cohort". */
  label: string;
  /** The chosen value. */
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 py-1 pl-2 pr-1 text-[12px] font-medium text-primary-800">
      <span className="text-primary-500">{label}:</span>
      <span className="max-w-[180px] truncate font-semibold">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="flex h-4 w-4 items-center justify-center rounded text-primary-500 transition hover:bg-primary-200/60 hover:text-primary-800"
      >
        <AppIcon className="ri-close-line text-[13px]"></AppIcon>
      </button>
    </span>
  );
});

/** Clears every applied filter at once. Sits at the end of the chip row. */
export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-foreground-500 transition hover:bg-background-100 hover:text-foreground-800"
    >
      <AppIcon className="ri-close-circle-line text-[13px]"></AppIcon>
      Clear all
    </button>
  );
}

// --- view toggle ------------------------------------------------------------

/**
 * Cards / table switch. Meaningful rather than decorative: cards suit a small
 * caseload you are getting to know, the table is what survives a hundred rows.
 */
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; icon: string; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-foreground-200 bg-background-100 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.label}
            aria-label={option.label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition',
              active
                ? 'bg-background-50 text-primary-700 shadow-sm'
                : 'text-foreground-500 hover:text-foreground-800',
            )}
          >
            <AppIcon className={cn(option.icon, 'text-[15px]')}></AppIcon>
          </button>
        );
      })}
    </div>
  );
}
