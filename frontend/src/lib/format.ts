// ============================================================================
// Value formatting for operational screens.
//
// Pure functions only. Promoted out of the coach caseload page, which was the
// only place in the workspace that had them, so that every other screen stops
// re-deriving "42 / 60 hrs" and "6 days ago" slightly differently.
//
// Nothing here invents a value: every helper has an explicit "not available"
// answer, because a large part of this payload is genuinely blank for some
// learners and a zero would be a lie.
// ============================================================================

export const EMPTY_VALUE = '--';

// The mojibake em dash below is deliberate: some imported rows carry a
// double-encoded em dash where a blank was meant, and it has to read as empty.
const PLACEHOLDER_VALUES = new Set([EMPTY_VALUE, '-', '—', 'â€”']);

export function displayValue(value?: string | null): string {
  if (!value) return EMPTY_VALUE;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed)) return EMPTY_VALUE;
  return trimmed;
}

/** True when a string field carries real content rather than a placeholder. */
export function hasValue(value?: string | null): boolean {
  return displayValue(value) !== EMPTY_VALUE;
}

export function clampPercent(value?: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

/**
 * Numbers arriving as text. Django stores several hour columns as TextField, so
 * "-12.8", "12.8" and "--" all turn up in the same field.
 */
export function parseNumeric(value?: string | number | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

// --- dates ------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parse the two date shapes the API emits: Django's `format_date` output
 * ("14 Jul 2027") and raw ISO ("2027-07-14"). Returns midnight local time so
 * day arithmetic against `startOfToday()` is exact.
 */
export function parseDisplayDate(value?: string | null): Date | null {
  if (!hasValue(value)) return null;
  const text = displayValue(value);

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const dmy = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (dmy) {
    const monthIndex = MONTHS.indexOf(dmy[2].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      return new Date(Number(dmy[3]), monthIndex, Number(dmy[1]));
    }
  }

  return null;
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `today` to `date`. Negative once the date is in the past. */
export function daysBetween(today: Date, date: Date): number {
  return Math.round((date.getTime() - today.getTime()) / MS_PER_DAY);
}

/** Human phrasing for a day offset: "Today", "in 12 days", "6 days ago". */
export function formatDayOffset(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 0) {
    if (days < 60) return `in ${days} days`;
    const months = Math.round(days / 30);
    if (months < 24) return `in ${months} months`;
    return `in ${Math.round(days / 365)} years`;
  }
  const ago = Math.abs(days);
  if (ago < 60) return `${ago} days ago`;
  const months = Math.round(ago / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(ago / 365)} years ago`;
}

/** Days from today to a date string, or null when the date is unusable. */
export function daysUntil(value?: string | null): number | null {
  const parsed = parseDisplayDate(value);
  return parsed ? daysBetween(startOfToday(), parsed) : null;
}

// --- numbers ----------------------------------------------------------------

const HOURS_FORMAT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const WHOLE_FORMAT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function formatHours(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EMPTY_VALUE;
  return HOURS_FORMAT.format(value);
}

/** "42 / 60 hrs" — the ratio a coach reads, with its unit attached. */
export function formatHoursRatio(completed?: number | null, target?: number | null): string {
  if (
    typeof completed !== 'number'
    || typeof target !== 'number'
    || !Number.isFinite(completed)
    || !Number.isFinite(target)
  ) {
    return EMPTY_VALUE;
  }
  return `${HOURS_FORMAT.format(completed)} / ${HOURS_FORMAT.format(target)} hrs`;
}

export function formatRatio(completed?: number | null, target?: number | null): string {
  if (typeof completed !== 'number' || typeof target !== 'number' || target <= 0) return EMPTY_VALUE;
  return `${completed} / ${target}`;
}

export function formatPercent(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${WHOLE_FORMAT.format(value)}%`;
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

// --- identity ---------------------------------------------------------------

/**
 * Initials from a person's name. There were three byte-identical copies of this
 * across the coach workspace; this is the one.
 */
export function initialsFor(name?: string | null): string {
  const text = displayValue(name);
  if (text === EMPTY_VALUE) return '?';
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function normalizeIdentity(value?: string | number | null): string {
  if (value === null || value === undefined) return '';
  return displayValue(String(value)).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// --- attendance thresholds --------------------------------------------------

/**
 * The thresholds the backend itself uses (`attendance_risk_from_rate`):
 * green at 90% and above, amber from 80%, red below 80%. Mirrored rather than
 * re-invented so the reason text a coach reads matches the RAG they are shown.
 *
 * These were defined twice — in the caseload page and again in the dashboard —
 * which is exactly how two screens start disagreeing about who is at risk.
 */
export const ATTENDANCE_EXPECTED_RATE = 90;
export const ATTENDANCE_MINIMUM_RATE = 80;
