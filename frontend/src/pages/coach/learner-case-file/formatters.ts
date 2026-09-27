export function displayInline(value?: string | null, fallback = '--') {
  const text = String(value || '').trim();
  return text && text !== '--' ? text : fallback;
}

export function formatAttendanceFraction(present: number | null, sessions: number | null) {
  if (present === null || sessions === null) return '--';
  return `${Math.max(0, Math.round(present))} / ${Math.max(0, Math.round(sessions))}`;
}

export function formatAttendanceMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  if (!year || !number) return month;
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, number - 1, 1)));
}

export function formatAttendanceSessionDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}
