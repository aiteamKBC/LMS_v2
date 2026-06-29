export interface ICSEvent {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatICSDate(dateStr: string, timeStr: string): { start: string; end: string } {
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
  const { start, end } = formatICSDate(event.date, event.time);
  const now = `${new Date().getFullYear()}${pad(new Date().getMonth() + 1)}${pad(new Date().getDate())}T${pad(new Date().getHours())}${pad(new Date().getMinutes())}00`;

  const escape = (s: string) => s.replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KBC Academy//Learner Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `DTSTAMP:${now}`,
    `UID:${event.title.replace(/\s/g, '-')}-${start}@kbc-academy`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `LOCATION:${escape(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
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
  const allICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KBC Academy//Learner Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((event) => {
      const { start, end } = formatICSDate(event.date, event.time);
      const now = `${new Date().getFullYear()}${pad(new Date().getMonth() + 1)}${pad(new Date().getDate())}T${pad(new Date().getHours())}${pad(new Date().getMinutes())}00`;
      const escape = (s: string) => s.replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
      return [
        'BEGIN:VEVENT',
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `DTSTAMP:${now}`,
        `UID:${event.title.replace(/\s/g, '-')}-${start}@kbc-academy`,
        `SUMMARY:${escape(event.title)}`,
        `DESCRIPTION:${escape(event.description)}`,
        `LOCATION:${escape(event.location)}`,
        'END:VEVENT',
      ];
    }),
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
  const allICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KBC Academy//Learner Calendar Public Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:KBC Academy Learner Calendar',
    'X-WR-CALDESC:Public read-only calendar feed for KBC Academy learner events',
    ...events.flatMap((event) => {
      const { start, end } = formatICSDate(event.date, event.time);
      const now = `${new Date().getFullYear()}${pad(new Date().getMonth() + 1)}${pad(new Date().getDate())}T${pad(new Date().getHours())}${pad(new Date().getMinutes())}00`;
      const escape = (s: string) => s.replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
      return [
        'BEGIN:VEVENT',
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `DTSTAMP:${now}`,
        `UID:${event.title.replace(/\s/g, '-')}-${start}@kbc-academy`,
        `SUMMARY:${escape(event.title)}`,
        `DESCRIPTION:${escape(event.description)}`,
        `LOCATION:${escape(event.location)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ];
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