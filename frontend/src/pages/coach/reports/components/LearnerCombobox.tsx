// ============================================================================
// Learner combobox — single-select with search-to-filter.
//
// `FilterSelect` (@/components/ui/FilterToolbar) covers a plain single-select
// dropdown, but has no built-in search box, and this list runs to the size of a
// whole caseload. So this keeps its own interaction (type to filter, then
// pick), and instead matches `SearchInput`/`FilterSelect`'s visual language:
// h-9 controls, rounded-lg, the same border and focus-ring treatment.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { LearnerSelectOption } from '../page';

export function LearnerCombobox({
  options,
  value,
  onChange,
  placeholder = 'Select learner',
}: {
  options: LearnerSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => options.find(option => option.value === value) || null, [options, value]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter(option => (
      option.label.toLowerCase().includes(query) || option.searchText.includes(query)
    ));
  }, [options, search]);

  useEffect(() => {
    if (!open) return undefined;

    searchInputRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen(current => !current);
          setSearch('');
        }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3 text-left text-[13px] font-medium text-foreground-900 transition hover:border-foreground-300 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200/50"
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <AppIcon
          className={cn('ri-arrow-down-s-line shrink-0 text-[15px] text-foreground-400 transition-transform', open && 'rotate-180')}
        ></AppIcon>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 rounded-lg border border-foreground-200 bg-background-50 p-1.5 shadow-panel">
          <div className="relative mb-1.5">
            <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400"></AppIcon>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search learner, cohort, group..."
              aria-label="Search learners"
              className="h-9 w-full rounded-lg border border-foreground-200 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 placeholder:text-foreground-400 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200/50"
            />
          </div>

          <div role="listbox" aria-label="Choose learner" className="max-h-64 overflow-y-auto">
            {filtered.map((option) => {
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
                    setSearch('');
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] transition',
                    active ? 'bg-primary-50 font-semibold text-primary-800' : 'text-foreground-700 hover:bg-background-100',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {active ? <AppIcon className="ri-check-line text-[14px]"></AppIcon> : null}
                </button>
              );
            })}

            {!filtered.length ? (
              <div className="px-2.5 py-4 text-center text-[12px] text-foreground-400">
                No learners match your search.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
