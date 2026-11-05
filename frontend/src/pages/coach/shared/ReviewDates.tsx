import { eventDisplayDate, formatDateLabel, formatTimeRangeLabel, type CoachCalendarEvent } from './calendarEvents';
import styles from '../monthly-coaching/monthlyCoaching.module.css';

/** Completion is an instant; appointment dates are already London calendar dates. */
function completionDay(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // Do not interpret an unzoned timestamp in the browser's own timezone.
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function ReviewScheduledDate({ event }: { event: CoachCalendarEvent }) {
  const date = eventDisplayDate(event);
  const planned = event.status === 'not-scheduled' || !event.scheduledDate
    || (event.reviewSource === 'aptem' && !event.calendarEventKey && !event.calendarEventId);
  const time = event.scheduledTime?.match(/^(\d{2}):(\d{2})/);
  const nextDays = time ? Math.floor((Number(time[1]) * 60 + Number(time[2]) + (event.durationMinutes || 60)) / 1440) : 0;
  return <span className={styles.date}>
    <span>{date ? `${planned ? 'Planned for ' : ''}${formatDateLabel(date)}` : 'Not scheduled'}</span>
    {!planned && <span>{formatTimeRangeLabel(event)}{nextDays > 0 ? ` (+${nextDays} ${nextDays === 1 ? 'day' : 'days'})` : ''}</span>}
  </span>;
}

export function ReviewCompletedDate({ event }: { event: CoachCalendarEvent }) {
  const completed = event.status === 'completed' ? completionDay(event.reviewCompletedAt) : null;
  const beforeAppointment = completed && event.scheduledDate && completed < event.scheduledDate;
  return <span className={styles.date}>
    <span>{completed ? formatDateLabel(completed) : event.status === 'completed' ? 'Not recorded' : '—'}</span>
    {beforeAppointment && <small title="The recorded completion date is before the scheduled appointment. Saved dates have not been changed." tabIndex={0}>Dates need review</small>}
  </span>;
}
