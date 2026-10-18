import { zonedNaiveToUtcIso } from '../module-builder/moduleAuthoringData';

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
  const second = Number(start.split(':')[2] || 0);
  const instant = new Date(zonedNaiveToUtcIso(start.slice(0, 16), 'Europe/London'));
  instant.setTime(instant.getTime() + second * 1000);
  return { start: instant.toISOString(), end: new Date(instant.getTime() + seconds * 1000).toISOString() };
}
