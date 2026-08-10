import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ThemedSelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface ThemedSelectProps<T extends string = string> {
  value: T;
  options: ThemedSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  menuPlacement?: 'auto' | 'below' | 'above';
  disabled?: boolean;
  placeholder?: string;
}

export function ThemedSelect<T extends string = string>({
  value,
  options,
  onChange,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  menuPlacement = 'auto',
  disabled = false,
  placeholder = 'Select',
}: ThemedSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState({ left: 0, top: 0, width: 0, maxHeight: 288 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => options.find(option => option.value === value), [options, value]);

  useEffect(() => {
    if (!open) return undefined;
    const positionMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedHeight = options.length * 36 + 8;
      const maxHeight = Math.max(80, Math.min(288, estimatedHeight, window.innerHeight - 24));
      const opensAbove = menuPlacement === 'above' || (menuPlacement === 'auto' && rect.bottom + maxHeight + 6 > window.innerHeight - 12);
      setMenuRect({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        top: opensAbove ? Math.max(12, rect.top - maxHeight - 6) : rect.bottom + 6,
        width: rect.width,
        maxHeight,
      });
    };
    positionMenu();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, menuPlacement, options.length]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        className={`h-10 w-full rounded-lg border border-[#d8dde6] bg-white px-3 text-left text-sm text-foreground-900 shadow-sm transition-smooth outline-none hover:border-[#b9aed8] focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe] disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] ${buttonClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate">{selected?.label || placeholder}</span>
          <AppIcon className={`ri-arrow-down-s-line text-[#647083] transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
        </span>
      </button>
      {open && !disabled && createPortal(
        <div
          ref={menuRef}
          className={`fixed z-[120] max-h-72 overflow-y-auto rounded-xl border border-[#d8dde6] bg-white py-1 shadow-xl shadow-[#231942]/12 quiz-preview-scroll ${menuClassName}`}
          style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width, maxHeight: menuRect.maxHeight }}
          role="listbox"
        >
          {options.map(option => {
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
                className={`flex h-9 w-full items-center justify-between px-3 text-left text-sm transition-smooth ${active ? 'bg-[#f2f0ff] text-[#4c1d95] font-semibold' : 'text-[#1f2937] hover:bg-[#f8fafc]'}`}
              >
                <span className="truncate">{option.label}</span>
                {active && <AppIcon className="ri-check-line text-[#5b2dbb]"></AppIcon>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
