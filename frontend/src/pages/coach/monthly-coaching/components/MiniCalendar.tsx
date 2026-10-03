import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import type { CoachCalendarEvent } from '../../shared/calendarEvents';
import { MEETING_STATUS_COLORS, MEETING_STATUS_LABELS, formatMonthYear, getCalendarDays, getCalendarDots, todayKey } from '../meetingsView';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MiniCalendar({ month, events, onMonthChange }: {
  month: Date;
  events: CoachCalendarEvent[];
  onMonthChange: (offset: number) => void;
}) {
  const days = getCalendarDays(month);
  const dots = getCalendarDots(events);
  const today = todayKey();

  return (
    <section aria-label={`Meeting calendar for ${formatMonthYear(month)}`} className="rounded-[20px] border border-primary-100 bg-white p-4 shadow-[0_10px_30px_-18px_rgb(76_29_149/0.35)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-primary-900">{formatMonthYear(month)}</h3>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onMonthChange(-1)} aria-label="Calendar previous month" className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary-100 text-primary-700 transition hover:bg-primary-50"><AppIcon className="ri-arrow-left-s-line" /></button>
          <button type="button" onClick={() => onMonthChange(1)} aria-label="Calendar next month" className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary-100 text-primary-700 transition hover:bg-primary-50"><AppIcon className="ri-arrow-right-s-line" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center" role="grid" aria-readonly="true">
        {WEEKDAYS.map(day => <span key={day} role="columnheader" className="pb-1 text-[10px] font-semibold text-foreground-400">{day}</span>)}
        {days.map(day => {
          const dayDots = day.inMonth ? dots.get(day.key) || [] : [];
          const isToday = day.inMonth && day.key === today;
          const label = dayDots.length ? `${day.key}: ${dayDots.map(status => MEETING_STATUS_LABELS[status]).join(', ')}` : day.key;
          return (
            <span key={day.key} role="gridcell" aria-label={label} aria-current={isToday ? 'date' : undefined} className="flex flex-col items-center gap-0.5 py-0.5">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold',
                !day.inMonth && 'text-foreground-300',
                day.inMonth && !isToday && 'text-foreground-700',
                isToday && 'bg-primary-700 text-white shadow-sm')}>{day.day}</span>
              <span className="flex h-1.5 gap-0.5" aria-hidden="true">
                {dayDots.map(status => <i key={status} className={cn('h-1.5 w-1.5 rounded-full', MEETING_STATUS_COLORS[status].dot)} />)}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
