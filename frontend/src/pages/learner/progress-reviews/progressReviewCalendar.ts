import { bookingInstant } from '../reviews/bookingDates';

type ProgressReviewCalendarEvent = {
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  title: string;
  meetingLink?: string | null;
};

function icsUtcDate(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function progressReviewCalendarContent(event: ProgressReviewCalendarEvent): string {
  const start = bookingInstant(event.scheduledDate, event.scheduledTime);
  const end = start + event.durationMinutes * 60_000;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART:${icsUtcDate(start)}`,
    `DTEND:${icsUtcDate(end)}`,
    `SUMMARY:${event.title}`,
    event.meetingLink ? `URL:${event.meetingLink}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
