import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import type { DirectoryCoach } from '@/api/coachDirectory';
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  fetchCoachCalendarEventsForCoach,
  formatTimeLabel,
  needsScheduling,
  parseLocalDate,
  statusLabel,
} from '@/pages/coach/shared/calendarEvents';

interface AggregatedEvent {
  coach: DirectoryCoach;
  event: CoachCalendarEvent;
}

const COACH_COLOURS = [
  { dot: 'bg-primary-500', card: 'border-primary-200 bg-primary-50/70', text: 'text-primary-700' },
  { dot: 'bg-emerald-500', card: 'border-emerald-200 bg-emerald-50/70', text: 'text-emerald-700' },
  { dot: 'bg-amber-500', card: 'border-amber-200 bg-amber-50/70', text: 'text-amber-700' },
  { dot: 'bg-sky-500', card: 'border-sky-200 bg-sky-50/70', text: 'text-sky-700' },
  { dot: 'bg-violet-500', card: 'border-violet-200 bg-violet-50/70', text: 'text-violet-700' },
  { dot: 'bg-rose-500', card: 'border-rose-200 bg-rose-50/70', text: 'text-rose-700' },
] as const;

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return date;
}

function weekDays(anchor: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() + index);
    return date;
  });
}

function coachLabel(coach: DirectoryCoach) {
  return coach.name.trim() || coach.email;
}

function eventTime(event: CoachCalendarEvent) {
  if (needsScheduling(event)) return 'Needs scheduling';
  return formatTimeLabel(event);
}

export function AllCoachesCalendar({
  coaches,
  onOpenCoach,
}: {
  coaches: DirectoryCoach[];
  onOpenCoach: (coach: DirectoryCoach, event: CoachCalendarEvent) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedCoach, setSelectedCoach] = useState('all');
  const [events, setEvents] = useState<AggregatedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [failedCoaches, setFailedCoaches] = useState<string[]>([]);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = days[6];

  useEffect(() => {
    if (!coaches.length) {
      setEvents([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailedCoaches([]);

    Promise.allSettled(coaches.map(async coach => {
      const response = await fetchCoachCalendarEventsForCoach(coach.email, controller.signal, {
        start: isoDate(weekStart),
        end: isoDate(weekEnd),
        includeSchedulerQueues: false,
      });
      return (response.events || []).map(event => ({ coach, event }));
    })).then(results => {
      if (controller.signal.aborted) return;
      const nextEvents: AggregatedEvent[] = [];
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') nextEvents.push(...result.value);
        else failures.push(coachLabel(coaches[index]));
      });
      setEvents(nextEvents);
      setFailedCoaches(failures);
      setLoading(false);
    });

    return () => controller.abort();
  }, [coaches, weekStart, weekEnd]);

  const visibleEvents = useMemo(() => events
    .filter(item => selectedCoach === 'all' || item.coach.email === selectedCoach)
    .filter(item => Boolean(parseLocalDate(eventDisplayDate(item.event))))
    .sort((left, right) => {
      const dateDifference = (parseLocalDate(eventDisplayDate(left.event))?.getTime() || 0)
        - (parseLocalDate(eventDisplayDate(right.event))?.getTime() || 0);
      if (dateDifference) return dateDifference;
      return (left.event.scheduledTime || '99:99').localeCompare(right.event.scheduledTime || '99:99');
    }), [events, selectedCoach]);

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, AggregatedEvent[]>();
    days.forEach(day => grouped.set(isoDate(day), []));
    visibleEvents.forEach(item => grouped.get(eventDisplayDate(item.event).slice(0, 10))?.push(item));
    return grouped;
  }, [days, visibleEvents]);

  const colourByCoach = useMemo(() => new Map(coaches.map((coach, index) => [
    coach.email,
    COACH_COLOURS[index % COACH_COLOURS.length],
  ])), [coaches]);
  const scheduledCount = visibleEvents.filter(item => !needsScheduling(item.event) && item.event.status !== 'cancelled').length;
  const needsScheduleCount = visibleEvents.filter(item => needsScheduling(item.event)).length;
  const activeCoachCount = new Set(visibleEvents.map(item => item.coach.email)).size;
  const today = isoDate(new Date());

  const moveWeek = (offset: number) => {
    setWeekStart(current => {
      const next = new Date(current);
      next.setDate(current.getDate() + offset * 7);
      return next;
    });
  };

  return (
    <section className="rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-foreground-200/60 p-4 md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
              <AppIcon className="ri-calendar-2-line" />
            </span>
            <div>
              <h2 className="text-lg font-heading font-semibold text-foreground-900">All coaches calendar</h2>
              <p className="text-[12px] text-foreground-400">Every coach's sessions and reviews in one read-only view</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter calendar by coach"
            value={selectedCoach}
            onChange={event => setSelectedCoach(event.target.value)}
            className="h-9 min-w-44 rounded-lg border border-foreground-200 bg-white px-3 text-[12px] font-semibold text-foreground-700 focus:border-primary-400 focus:outline-none"
          >
            <option value="all">All coaches</option>
            {coaches.map(coach => <option key={coach.email} value={coach.email}>{coachLabel(coach)}</option>)}
          </select>
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="h-9 rounded-lg border border-foreground-200 bg-white px-3 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">Today</button>
          <div className="flex overflow-hidden rounded-lg border border-foreground-200 bg-white">
            <button type="button" aria-label="Previous week" onClick={() => moveWeek(-1)} className="flex h-9 w-9 items-center justify-center hover:bg-background-100"><AppIcon className="ri-arrow-left-s-line" /></button>
            <button type="button" aria-label="Next week" onClick={() => moveWeek(1)} className="flex h-9 w-9 items-center justify-center border-l border-foreground-200 hover:bg-background-100"><AppIcon className="ri-arrow-right-s-line" /></button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-foreground-200/60 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
        <p className="text-sm font-semibold text-foreground-800">
          {weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
        <div className="flex flex-wrap gap-4 text-[11px] text-foreground-500">
          <span><strong className="text-foreground-900">{scheduledCount}</strong> scheduled</span>
          <span><strong className="text-foreground-900">{needsScheduleCount}</strong> need scheduling</span>
          <span><strong className="text-foreground-900">{activeCoachCount}</strong> coaches with activity</span>
        </div>
      </div>

      {failedCoaches.length > 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 md:mx-6">
          Could not load: {failedCoaches.join(', ')}. The other calendars are still shown.
        </div>
      )}

      <div className="p-4 md:p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            {days.map(day => <div key={isoDate(day)} className="h-40 animate-pulse rounded-xl bg-background-100" />)}
          </div>
        ) : !visibleEvents.length ? (
          <EmptyState variant="empty" icon="ri-calendar-check-line" title="No calendar activity this week" description="There are no sessions or reviews for the selected coaches in this week." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            {days.map(day => {
              const key = isoDate(day);
              const dayEvents = eventsByDay.get(key) || [];
              const isToday = key === today;
              return (
                <div key={key} className={`min-h-40 rounded-xl border ${isToday ? 'border-primary-300 bg-primary-50/30' : 'border-foreground-200/60 bg-white'}`}>
                  <div className="flex items-center justify-between border-b border-foreground-200/50 px-3 py-2.5">
                    <span className={`text-[11px] font-semibold ${isToday ? 'text-primary-700' : 'text-foreground-500'}`}>{day.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${isToday ? 'bg-primary-600 text-white' : 'text-foreground-800'}`}>{day.getDate()}</span>
                  </div>
                  <div className="space-y-2 p-2">
                    {dayEvents.length ? dayEvents.map(({ coach, event }, index) => {
                      const colour = colourByCoach.get(coach.email) || COACH_COLOURS[0];
                      return (
                        <button
                          key={`${coach.email}-${event.eventKey || event.id}-${index}`}
                          type="button"
                          onClick={() => onOpenCoach(coach, event)}
                          className={`w-full rounded-lg border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${colour.card}`}
                        >
                          <span className={`block truncate text-[10px] font-bold ${colour.text}`}>{eventTime(event)}</span>
                          <span className="mt-0.5 block truncate text-[11px] font-semibold text-foreground-900">{event.learner || event.title}</span>
                          <span className="mt-1 flex items-center gap-1 truncate text-[10px] text-foreground-500"><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${colour.dot}`} />{coachLabel(coach)}</span>
                          <span className="mt-1 block truncate text-[9px] text-foreground-400">{statusLabel(event.status)}</span>
                        </button>
                      );
                    }) : <p className="py-4 text-center text-[10px] text-foreground-300">No events</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {coaches.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-foreground-200/60 pt-4">
            {coaches.map((coach, index) => (
              <button key={coach.email} type="button" onClick={() => setSelectedCoach(current => current === coach.email ? 'all' : coach.email)} className={`flex items-center gap-1.5 text-[10px] font-semibold ${selectedCoach === coach.email ? 'text-foreground-900' : 'text-foreground-500 hover:text-foreground-800'}`}>
                <i className={`h-2 w-2 rounded-full ${COACH_COLOURS[index % COACH_COLOURS.length].dot}`} />{coachLabel(coach)}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
