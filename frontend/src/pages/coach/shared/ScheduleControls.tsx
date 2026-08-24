// ============================================================================
// Scheduling controls — shared between Coaching Meetings and Progress Reviews.
//
// Both queues book the same kind of thing (a date, a time, a duration) against
// the same calendar endpoint, and used to render it with two different widgets
// — a calendar popover on one page, a bare `<input type="date">` on the other.
// One picker now, so "schedule" looks and behaves the same wherever a coach
// meets it.
// ============================================================================
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function calendarIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The boxed label/value tile used inside an expanded row — target date, cohort, programme. */
export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-foreground-200/70 bg-background-50 p-3.5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-400">{label}</p>
      <p className="mt-1 text-[13px] font-semibold text-foreground-800">{value}</p>
    </div>
  );
}

export function ScheduleFieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-foreground-400">{children}</span>;
}

export function ScheduleTimeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-foreground-200 bg-background-50 px-3 py-2.5 text-[13px] text-foreground-900 transition focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
    />
  );
}

export function ModernDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedDate = value ? parseCalendarDate(value) : null;
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const initial = parseCalendarDate(value);
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });

  useEffect(() => {
    if (!value) return;
    const next = parseCalendarDate(value);
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  const firstVisibleDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - viewMonth.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => (
    new Date(firstVisibleDay.getFullYear(), firstVisibleDay.getMonth(), firstVisibleDay.getDate() + index)
  ));
  const todayIso = calendarIso(new Date());
  const selectedIso = selectedDate ? calendarIso(selectedDate) : '';
  const displayValue = selectedDate
    ? selectedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Select a date';

  const moveMonth = (offset: number) => {
    setViewMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const chooseDate = (date: Date) => {
    onChange(calendarIso(date));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border bg-background-50 px-3 py-2.5 text-left text-[13px] transition',
          open ? 'border-primary-300 ring-2 ring-primary-100' : 'border-foreground-200 hover:border-primary-200',
        )}
      >
        <span className={cn('flex items-center gap-2', selectedDate ? 'font-semibold text-foreground-800' : 'text-foreground-400')}>
          <AppIcon className="ri-calendar-line text-primary-600"></AppIcon>
          {displayValue}
        </span>
        <AppIcon className={cn('ri-arrow-down-s-line text-foreground-400 transition', open && 'rotate-180')}></AppIcon>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-[80] mt-2 w-[310px] rounded-2xl border border-foreground-200/70 bg-white p-4 shadow-panel">
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={() => moveMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-500 hover:bg-primary-50 hover:text-primary-700" aria-label="Previous month">
              <AppIcon className="ri-arrow-left-s-line text-lg"></AppIcon>
            </button>
            <div className="text-center">
              <p className="text-[13px] font-bold text-foreground-900">{viewMonth.toLocaleDateString('en-GB', { month: 'long' })}</p>
              <p className="text-[12px] text-foreground-400">{viewMonth.getFullYear()}</p>
            </div>
            <button type="button" onClick={() => moveMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-500 hover:bg-primary-50 hover:text-primary-700" aria-label="Next month">
              <AppIcon className="ri-arrow-right-s-line text-lg"></AppIcon>
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <span key={day} className="py-1 text-center text-[12px] font-bold uppercase text-foreground-300">{day}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map(day => {
              const iso = calendarIso(day);
              const inCurrentMonth = day.getMonth() === viewMonth.getMonth();
              const selected = iso === selectedIso;
              const today = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => chooseDate(day)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg text-[12px] font-semibold transition',
                    selected
                      ? 'bg-primary-700 text-white shadow-sm'
                      : today
                        ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                        : inCurrentMonth
                          ? 'text-foreground-700 hover:bg-primary-50 hover:text-primary-700'
                          : 'text-foreground-300 hover:bg-background-100',
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-foreground-100 pt-3">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-foreground-400 hover:bg-background-100 hover:text-foreground-700">Clear</button>
            <button type="button" onClick={() => chooseDate(new Date())} className="rounded-lg bg-primary-50 px-3 py-1.5 text-[12px] font-bold text-primary-700 hover:bg-primary-100">Today</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DURATION_OPTIONS = [
  { value: 30, label: '30 minutes', hint: 'Quick check-in' },
  { value: 45, label: '45 minutes', hint: 'Focused session' },
  { value: 60, label: '60 minutes', hint: 'Standard meeting' },
  { value: 90, label: '90 minutes', hint: 'Extended review' },
];

export function ModernDurationPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  const selected = DURATION_OPTIONS.find(option => option.value === value) || DURATION_OPTIONS[2];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border bg-background-50 px-3 py-2.5 text-left transition',
          open ? 'border-primary-300 ring-2 ring-primary-100' : 'border-foreground-200 hover:border-primary-200',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-50 text-primary-600"><AppIcon className="ri-timer-line text-[12px]"></AppIcon></span>
          <span>
            <span className="block text-[13px] font-semibold text-foreground-800">{selected.label}</span>
            <span className="block text-[12px] text-foreground-400">{selected.hint}</span>
          </span>
        </span>
        <AppIcon className={cn('ri-arrow-down-s-line text-foreground-400 transition', open && 'rotate-180')}></AppIcon>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-[80] mt-2 w-full min-w-[230px] overflow-hidden rounded-2xl border border-foreground-200/70 bg-white p-1.5 shadow-panel">
          {DURATION_OPTIONS.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                  active ? 'bg-primary-50 text-primary-800' : 'text-foreground-700 hover:bg-background-100',
                )}
              >
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[12px] font-bold', active ? 'bg-primary-700 text-white' : 'bg-background-100 text-foreground-500')}>
                  {option.value}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold">{option.label}</span>
                  <span className="block text-[12px] text-foreground-400">{option.hint}</span>
                </span>
                {active ? <AppIcon className="ri-check-line text-primary-700"></AppIcon> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
