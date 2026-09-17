/**
 * Stamps and spans, as the audit trail shows them.
 *
 * Shared by the People list and one person's activity page so the two never
 * disagree about what "Today 14:32" means. The change feed's own day grouping
 * stays in `page.tsx`, where it is the only thing that uses it.
 */

/**
 * The backend writes UTC. Whether the driver hands back a bare
 * `2026-09-09T10:00:00` or an offset-bearing `...+00:00` depends on the column
 * type, so the marker is only added when the string carries no zone of its own
 * — appending one unconditionally turns every offset stamp into an invalid date
 * and the whole time column silently blanks.
 */
export function parseActivityStamp(value: string): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const parsed = new Date(zoned ? text : `${text}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `Today 14:32`, `Yesterday 09:05`, `16 Sep 2026 14:32`. Empty for no stamp. */
export function stampLabel(value: string): string {
  const parsed = parseActivityStamp(value);
  if (!parsed) return '';
  const time = parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDay.getTime()) / 86_400_000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  return `${parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${time}`;
}

/** `14:32` alone, for a row already sitting under its own date. */
export function clockLabel(value: string): string {
  const parsed = parseActivityStamp(value);
  return parsed ? parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

/**
 * How long a page was open.
 *
 * `null` is not zero and must not read as it: a tab closed before the duration
 * could be reported is an unknown, and the caller shows it as such rather than
 * printing "0s" against a page somebody spent ten minutes on.
 */
export function durationLabel(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** The span between two stamps, for a whole visit. */
export function spanLabel(from: string, to: string): string {
  const start = parseActivityStamp(from);
  const end = parseActivityStamp(to);
  if (!start || !end) return '';
  return durationLabel(Math.max(0, end.getTime() - start.getTime()));
}
