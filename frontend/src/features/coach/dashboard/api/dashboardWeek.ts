import { useEffect, useState } from 'react';
import { systemDateParts } from '@/lib/format';
import { getCurrentWorkWeekRange as calendarWeekRange, eventDisplayDate, parseLocalDate, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';

export function dashboardBusinessDate(now = new Date()) {
  const { year, month, day } = systemDateParts(now)!;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dashboardWorkWeek(offset = 0, now = new Date()) {
  const [year, month, day] = dashboardBusinessDate(now).split('-').map(Number);
  // Calendar-only Date for existing label formatters; the device timezone
  // never decides which business day/week this instant belongs to.
  const { start, end } = calendarWeekRange(new Date(year, month - 1, day));
  start.setDate(start.getDate() + offset * 7);
  end.setDate(end.getDate() + offset * 7);
  return { start, end };
}

export const getCurrentWorkWeekRange = () => dashboardWorkWeek();
export const getNextWorkWeekRange = () => dashboardWorkWeek(1);

export function isEventThisWeek(event: CoachCalendarEvent) {
  const day = parseLocalDate(eventDisplayDate(event));
  const { start, end } = dashboardWorkWeek();
  return Boolean(day && event.status !== 'completed' && day >= start && day <= end);
}

export function millisecondsUntilBusinessMidnight(now = new Date()) {
  const today = dashboardBusinessDate(now);
  let lower = now.getTime(), upper = lower + 36 * 60 * 60 * 1000;
  // Locate the business-date boundary as an instant, including GMT/BST days.
  while (upper - lower > 1) {
    const midpoint = Math.floor((lower + upper) / 2);
    if (dashboardBusinessDate(new Date(midpoint)) === today) lower = midpoint;
    else upper = midpoint;
  }
  return upper - now.getTime();
}

export function useDashboardBusinessDate() {
  const [day, setDay] = useState(() => dashboardBusinessDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setDay(dashboardBusinessDate());
      timer = setTimeout(refresh, millisecondsUntilBusinessMidnight());
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return day;
}
