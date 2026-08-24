// ============================================================================
// Coach caseload — the coach's own RAG flag, editable in place.
//
// This writes to PATCH /coach_api/coach/caseload/{id}/coach-rag. The control
// existed before but had become unreachable when the page's second render branch
// was left behind an earlier `return`, so the endpoint had no caller. It is wired
// back into the table and the quick view here.
//
// It portals its menu to the body so a row with `overflow-hidden` above it cannot
// clip the options, and it stops propagation so choosing a value never doubles as
// a click on the row it sits in.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  EMPTY_VALUE,
  formatCoachRagValue,
  getCoachRagDotClass,
  getCoachRagOptionValue,
  getCoachRagStyle,
} from '../lib/format';

const COACH_RAG_OPTIONS = [
  { value: '', label: EMPTY_VALUE },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
];

export function CoachRagSelector({
  value,
  learnerName,
  saving,
  onChange,
}: {
  value?: string;
  learnerName: string;
  saving: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState({ top: 0, left: 0, width: 112 });

  const selectedValue = getCoachRagOptionValue(value);
  const selectedLabel = formatCoachRagValue(value);
  const selectedStyle = getCoachRagStyle(selectedLabel);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(120, rect.width + 24);
      setMenuRect({
        top: rect.bottom + 4,
        left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.left)),
        width,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Coach RAG for ${learnerName}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={`inline-flex min-w-[74px] items-center justify-between gap-1.5 rounded-md border px-1.5 py-1 text-[12px] font-semibold transition hover:brightness-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-wait disabled:opacity-70 ${selectedStyle.bg} ${selectedStyle.border} ${selectedStyle.text}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${getCoachRagDotClass(selectedLabel)}`}></span>
          {selectedLabel}
        </span>
        <AppIcon
          className={`text-[12px] ${saving ? 'ri-loader-4-line animate-spin' : open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}
        ></AppIcon>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={`Select Coach RAG for ${learnerName}`}
            className="fixed z-[1000] rounded-md border border-foreground-200 bg-white p-1 shadow-panel"
            style={{ top: menuRect.top, left: menuRect.left, minWidth: menuRect.width }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {COACH_RAG_OPTIONS.map((option) => {
              const optionLabel = formatCoachRagValue(option.label);
              const optionStyle = getCoachRagStyle(optionLabel);
              const isSelected = option.value === selectedValue;

              return (
                <button
                  key={option.value || 'empty'}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setOpen(false);
                    onChange(option.value);
                    triggerRef.current?.focus();
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[12px] font-medium transition ${
                    isSelected ? `${optionStyle.bg} ${optionStyle.text} font-semibold` : 'text-foreground-700 hover:bg-background-100'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${getCoachRagDotClass(optionLabel)}`}></span>
                    {option.label}
                  </span>
                  {isSelected ? <AppIcon className="ri-check-line text-[13px]"></AppIcon> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
