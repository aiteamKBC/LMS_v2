import { localClockToUtcIso } from '@/lib/timeZones';

export interface ICSEvent {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  /** Full source date and zone; display dates alone cannot identify a year. */
  isoDate?: string;
  timeZone?: string | null;
  /** Authoritative instants take precedence over display clocks. */
  startsAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function utcICSDate(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatICSDate(event: ICSEvent): { start: string; end: string } {
  if (event.startsAt || event.endsAt) {
    const explicitInstant = /(?:Z|[+-]\d{2}:\d{2})$/i;
    if (!event.startsAt || !event.endsAt || !explicitInstant.test(event.startsAt) || !explicitInstant.test(event.endsAt)) {
      throw new Error('The event needs a start and end with an explicit time zone. Refresh the calendar and try again.');
    }
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new Error('The event has an invalid start or end time.');
    }
    return { start: utcICSDate(start), end: utcICSDate(end) };
  }

  if (event.isoDate || event.timeZone) {
    if (!event.isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(event.isoDate)) {
      throw new Error('The full event date is unavailable. Refresh the calendar and try again.');
    }
    if (!event.timeZone) {
      throw new Error('The event time zone is unavailable. Refresh the calendar and try again.');
    }
    const [startClock, endClock] = event.time.split('–').map(value => value.trim());
    if (!/^\d{2}:\d{2}$/.test(startClock)) throw new Error('The event start time is unavailable.');
    const start = new Date(localClockToUtcIso(`${event.isoDate}T${startClock}:00`, event.timeZone));
    let end: Date;
    if (event.durationMinutes !== undefined) {
      if (!Number.isFinite(event.durationMinutes) || event.durationMinutes <= 0) throw new Error('The event duration is invalid.');
      end = new Date(start.getTime() + event.durationMinutes * 60_000);
    } else {
      if (!endClock || !/^\d{2}:\d{2}$/.test(endClock)) throw new Error('The event end time is unavailable.');
      const nextDay = new Date(`${event.isoDate}T12:00:00Z`);
      if (endClock <= startClock) nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      end = new Date(localClockToUtcIso(`${nextDay.toISOString().slice(0, 10)}T${endClock}:00`, event.timeZone));
    }
    return { start: utcICSDate(start), end: utcICSDate(end) };
  }

  // Compatibility for the separate Clubs/demo callers that only supply display
  // dates. The learner calendar always supplies full dates and source zones.
  const dateStr = event.date;
  const timeStr = event.time;
  const monthMap: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  const parts = dateStr.split(' ');
  const day = parseInt(parts[0]);
  const monthName = parts[1];
  const month = monthMap[monthName] ?? 5;

  const year = new Date().getFullYear();
  const timeParts = timeStr.split('–');
  const startTime = timeParts[0].trim();
  const endTime = timeParts.length > 1 ? timeParts[1].trim() : '17:00';

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const fmt = (y: number, m: number, d: number, h: number, min: number) =>
    `${y}${pad(m + 1)}${pad(d)}T${pad(h)}${pad(min)}00`;

  return {
    start: fmt(year, month, day, startH, startM),
    end: fmt(year, month, day, endH, endM),
  };
}

export function generateICS(event: ICSEvent): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KBC Academy//Learner Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...eventLines(event, utcICSDate(new Date())),
    'END:VCALENDAR',
  ].join('\r\n');
}

function eventLines(event: ICSEvent, stamp: string): string[] {
  const { start, end } = formatICSDate(event);
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n');
  return [
    'BEGIN:VEVENT',
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `DTSTAMP:${stamp}`,
    `UID:${event.title.replace(/\s/g, '-')}-${start}@kbc-academy`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `LOCATION:${escape(event.location)}`,
    'END:VEVENT',
  ];
}

export function downloadICS(event: ICSEvent): void {
  const icsContent = generateICS(event);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.replace(/\s+/g, '-').toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadAllICS(events: ICSEvent[]): void {
  const stamp = utcICSDate(new Date());
  const allICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KBC Academy//Learner Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap(event => eventLines(event, stamp)),
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([allICS], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kbc-calendar-events.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generatePublicFeedICS(events: ICSEvent[]): string {
  const stamp = utcICSDate(new Date());
  const allICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KBC Academy//Learner Calendar Public Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:KBC Academy Learner Calendar',
    'X-WR-CALDESC:Public read-only calendar feed for KBC Academy learner events',
    ...events.flatMap((event) => {
      const lines = eventLines(event, stamp);
      lines.splice(lines.length - 1, 0, 'TRANSP:TRANSPARENT');
      return lines;
    }),
    'END:VCALENDAR',
  ].join('\r\n');
  return allICS;
}

export function createPublicFeedBlob(events: ICSEvent[]): string {
  const icsContent = generatePublicFeedICS(events);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  return URL.createObjectURL(blob);
}
