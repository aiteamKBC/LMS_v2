import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface DatePickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  error?: string;
  helper?: string;
}

export function DatePickerField({
  label,
  value,
  onChange,
  required,
  placeholder = 'Select date',
  disabled,
  min,
  max,
  error,
  helper,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = dateFromInput(value);
  const [viewDate, setViewDate] = useState<Date>(() => selectedDate || new Date());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  useEffect(() => {
    const nextSelectedDate = dateFromInput(value);
    if (!nextSelectedDate) return;
    setViewDate(new Date(nextSelectedDate.getFullYear(), nextSelectedDate.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(300, Math.min(360, rect.width + 64));
      const panelHeight = panelRef.current?.offsetHeight || 360;
      const gap = 8;
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const shouldOpenAbove = spaceBelow < panelHeight + gap && spaceAbove > spaceBelow;
      const top = shouldOpenAbove
        ? Math.max(12, rect.top - panelHeight - gap)
        : Math.min(rect.bottom + gap, window.innerHeight - panelHeight - 12);
      setPanelStyle({ left, top: Math.max(12, top), width });
    };
    updatePosition();
    const animationFrame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const calendarDays = buildCalendarDays(viewDate);
  const todayValue = toDateInput(new Date());
  const minDate = dateFromInput(min || '');
  const maxDate = dateFromInput(max || '');

  const isDateDisabled = (date: Date) => (
    Boolean(minDate && date < minDate) ||
    Boolean(maxDate && date > maxDate)
  );

  const selectDate = (date: Date) => {
    if (isDateDisabled(date)) return;
    onChange(toDateInput(date));
    setOpen(false);
  };

  const moveMonth = (amount: number) => {
    setViewDate(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const togglePicker = () => {
    if (disabled) return;
    setOpen(current => {
      const next = !current;
      const nextSelectedDate = dateFromInput(value);
      if (next && nextSelectedDate) {
        setViewDate(new Date(nextSelectedDate.getFullYear(), nextSelectedDate.getMonth(), 1));
      }
      return next;
    });
  };

  const picker = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={panelRef}
      className="fixed z-[10050] overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl"
      style={panelStyle}
    >
      <div className="border-b border-background-200 bg-background-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => moveMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 hover:text-primary-700" aria-label="Previous month">
            <AppIcon className="ri-arrow-left-s-line text-xl"></AppIcon>
          </button>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase text-foreground-400">Choose date</p>
            <p className="text-[13px] font-heading font-bold text-foreground-950">{monthLabel}</p>
          </div>
          <button type="button" onClick={() => moveMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 hover:text-primary-700" aria-label="Next month">
            <AppIcon className="ri-arrow-right-s-line text-xl"></AppIcon>
          </button>
        </div>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-7 gap-1 px-1 pb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <span key={day} className="text-center text-[10px] font-bold uppercase text-foreground-400">{day}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map(day => {
            const dayValue = toDateInput(day.date);
            const selected = value === dayValue;
            const today = todayValue === dayValue;
            const dayDisabled = isDateDisabled(day.date);
            return (
              <button
                key={dayValue}
                type="button"
                disabled={dayDisabled}
                onClick={() => selectDate(day.date)}
                className={`flex h-9 items-center justify-center rounded-lg text-[12px] font-bold transition-smooth disabled:cursor-not-allowed disabled:text-foreground-200 disabled:hover:bg-transparent ${selected ? 'bg-primary-600 text-white shadow-sm' : day.inCurrentMonth ? 'text-foreground-900 hover:bg-primary-50 hover:text-primary-700' : 'text-foreground-300 hover:bg-background-100'} ${today && !selected ? 'ring-1 ring-primary-200' : ''}`}
              >
                {day.date.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-background-200 bg-background-100/70 px-3 py-2">
        <button type="button" onClick={() => onChange('')} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-foreground-500 hover:bg-background-50 hover:text-red-600">
          Clear
        </button>
        <button type="button" onClick={() => selectDate(new Date())} disabled={isDateDisabled(new Date())} className="rounded-lg bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40">
          Today
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}{required ? ' *' : ''}</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePicker}
        disabled={disabled}
        className={`mt-1 flex h-[42px] w-full items-center gap-2 rounded-lg border bg-background-50 px-3 text-left text-[13px] font-semibold text-foreground-900 outline-none transition-smooth disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-500 ${open ? 'border-primary-300 ring-2 ring-primary-100' : error ? 'border-red-300' : 'border-background-200 hover:border-primary-200'}`}
      >
        <AppIcon className="ri-calendar-event-line text-foreground-400"></AppIcon>
        <span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-foreground-400'}`}>{formatDatePickerValue(value) || placeholder}</span>
        <AppIcon className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
      </button>
      {picker}
      {error ? <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p> : helper ? <p className="mt-1 text-[11px] text-foreground-400">{helper}</p> : null}
    </label>
  );
}

function parseDateParts(dateValue: string) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function dateFromInput(dateValue: string) {
  const parts = parseDateParts(dateValue);
  return parts ? new Date(parts.year, parts.month - 1, parts.day) : null;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDatePickerValue(value: string) {
  const parts = parseDateParts(value);
  if (!parts) return '';
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

function buildCalendarDays(viewDate: Date) {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const cursor = new Date(monthStart);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  return Array.from({ length: 42 }, () => {
    const date = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    return {
      date,
      inCurrentMonth: date.getMonth() === viewDate.getMonth(),
    };
  });
}
