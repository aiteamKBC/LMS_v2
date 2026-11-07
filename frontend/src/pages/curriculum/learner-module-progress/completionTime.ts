import { BUSINESS_TIME_ZONE, localClockToUtcIso } from '@/lib/timeZones';

export function localTimeInput(instant?: string | null) {
  if (!instant) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (key: string) => parts.find(item => item.type === key)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

export function completionEnd(start: string, seconds: number) {
  if (!start || !Number.isFinite(seconds) || seconds <= 0) return null;
  try {
    const instant = new Date(localClockToUtcIso(start, BUSINESS_TIME_ZONE));
    return { start: instant.toISOString(), end: new Date(instant.getTime() + seconds * 1000).toISOString() };
  } catch {
    return null; // Invalid/ambiguous input stays editable in the completion form.
  }
}
