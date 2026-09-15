/** Normalize stored clocks without losing AM/PM from older session records. */
export function normalizedClock(value: unknown): string {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) throw new Error('Choose a valid session time, including AM or PM when using a 12-hour clock.');
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) throw new Error('Choose a valid session time.');
  if (period) hour = hour % 12 + (period === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

export function clockLabel(value: unknown): string {
  if (!String(value ?? '').trim()) return 'Choose a time';
  try {
    const [hour, minute] = normalizedClock(value).split(':');
    return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? 'AM' : 'PM'}`;
  } catch { return 'Check this time'; }
}

export function calendarInputError(row: { sessions: { startTime: unknown; endTime: unknown }[] }): string {
  for (const session of row.sessions) {
    try {
      const start = normalizedClock(session.startTime);
      const end = normalizedClock(session.endTime);
      if (end <= start) return 'Each session must end after it starts. Check its AM/PM values.';
    } catch { return 'A session has a missing or invalid time. Correct its schedule before sending invitations.'; }
  }
  return '';
}

export function reviewDateLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(value)).replace(/\bam\b/, 'AM').replace(/\bpm\b/, 'PM');
}
