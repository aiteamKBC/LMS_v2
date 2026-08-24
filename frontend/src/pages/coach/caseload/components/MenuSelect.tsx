// ============================================================================
// Coach caseload — dropdown used by every filter and the sort control.
//
// Carried over from the previous page so the filters keep behaving exactly as
// coaches already expect (click outside to dismiss, Escape to close, a check on
// the current value). Restyled to the flatter, denser toolbar.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { FilterOption } from '../types';

export function MenuSelect({
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
    <div ref={rootRef} className={`relative ${widthClass}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 w-full items-center gap-1.5 rounded-md border px-2.5 text-left text-[12px] font-medium transition ${
          isActive
            ? 'border-primary-300 bg-primary-50 text-primary-800'
            : open
              ? 'border-primary-300 bg-white text-foreground-900'
              : 'border-foreground-200 bg-white text-foreground-700 hover:border-foreground-300'
        }`}
      >
        {icon ? <AppIcon className={`${icon} shrink-0 text-[13px] text-foreground-400`}></AppIcon> : null}
        {label ? <span className="shrink-0 text-foreground-400">{label}</span> : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <AppIcon className={`ri-arrow-down-s-line shrink-0 text-[14px] text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
      </button>

      {open ? (
        <div
          role="listbox"
          className={`absolute top-[calc(100%+4px)] z-50 max-h-72 w-max min-w-full overflow-y-auto rounded-md border border-foreground-200 bg-white p-1 shadow-panel ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
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
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded px-2.5 py-1.5 text-left text-[12px] transition ${
                  active
                    ? 'bg-primary-50 font-semibold text-primary-800'
                    : 'text-foreground-700 hover:bg-background-100'
                }`}
              >
                <span className="max-w-[280px] flex-1 truncate">{option.label}</span>
                {active ? <AppIcon className="ri-check-line text-[13px]"></AppIcon> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
