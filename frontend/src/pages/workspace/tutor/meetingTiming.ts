export const UK_TIME_ZONE = 'Europe/London';
const JOIN_WINDOW_MS = 30 * 60 * 1000;

/**
 * Session timestamps are UTC instants. Older API responses omitted the UTC
 * suffix, so treat an offset-less value as UTC instead of the tutor's browser
 * timezone (which may be somewhere other than the UK).
 */
export function scheduledInstant(value: string): Date | null {
  if (!value) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasOffset ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Button is enabled from 30 minutes before start until 30 minutes after end.
 * `now` is injectable so the boundary is testable.
 */
export function isJoinButtonEnabled(scheduledStart: string, scheduledEnd: string, now = Date.now()): boolean {
  if (!scheduledStart || !scheduledEnd) return false;

  const start = scheduledInstant(scheduledStart)?.getTime();
  const end = scheduledInstant(scheduledEnd)?.getTime();
  if (start == null || end == null || end < start) return false;

  return now >= start - JOIN_WINDOW_MS && now <= end + JOIN_WINDOW_MS;
}
