// UK working-calendar rules for the employee-arranged journal.
//
// Activity dates must land inside the report month being edited, on a working
// day: UK weekends (Saturday/Sunday) and England & Wales bank holidays are
// blocked. The ledger closes at August 2026 (see the backend's
// LEDGER_END_MONTH) so the holiday table only needs to cover these years.

import { WORKING_DAY_START_HOUR, WORKING_DAY_END_HOUR } from '@/lib/completionValidation';

export const LEDGER_END_MONTH = "2026-08";

// England & Wales bank holidays, 2024–2027 (gov.uk, incl. substitute days).
const UK_BANK_HOLIDAYS = new Set([
  // 2024
  "2024-01-01", "2024-03-29", "2024-04-01", "2024-05-06", "2024-05-27",
  "2024-08-26", "2024-12-25", "2024-12-26",
  // 2025
  "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-05", "2025-05-26",
  "2025-08-25", "2025-12-25", "2025-12-26",
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
  "2026-08-31", "2026-12-25", "2026-12-28",
  // 2027
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31",
  "2027-08-30", "2027-12-27", "2027-12-28",
]);

export function isUkBankHoliday(dateStr: string): boolean {
  return UK_BANK_HOLIDAYS.has(dateStr);
}

export function isUkWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** First/last day of a "YYYY-MM" month, for date-input min/max. */
export function monthBounds(month: string): { min: string; max: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { min: `${month}-01`, max: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Why a date cannot take an activity, or null when it can.
 * Pass the report month to also enforce the month window.
 */
export function dateRestriction(dateStr: string, month?: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "Choose a valid date.";
  if (month && !dateStr.startsWith(`${month}-`)) {
    return "The date must fall inside the report month you are editing.";
  }
  if (isUkWeekend(dateStr)) return "Weekends (UK) cannot take activities.";
  if (isUkBankHoliday(dateStr)) return "UK bank holidays cannot take activities.";
  return null;
}

export const WORK_DAY_START = `${String(WORKING_DAY_START_HOUR).padStart(2, '0')}:00:00`;
export const WORK_DAY_END = `${String(WORKING_DAY_END_HOUR).padStart(2, '0')}:00:00`;
export const WORK_DAY_LABEL = `${WORK_DAY_START.slice(0, 5)}–${WORK_DAY_END.slice(0, 5)} UK time`;

function toSeconds(time: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function toHhmmss(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * System-generated timestamp for claimed hours inside legal job hours
 * (08:00–17:00 UK time). Returns "HH:MM–HH:MM", or an error string when the claimed
 * hours cannot fit before 17:00.
 */
export function workingTimeRange(startTime: string, actualHours: number): { label: string } | { error: string } {
  if (!Number.isFinite(actualHours) || actualHours <= 0) {
    return { error: "Enter the actual (claimed) hours first — the timestamp is generated from them." };
  }
  const start = toSeconds(startTime || WORK_DAY_START);
  if (start < toSeconds(WORK_DAY_START)) return { error: `The start time cannot be before ${WORK_DAY_START} UK time.` };
  const end = start + Math.round(actualHours * 3600);
  if (end > toSeconds(WORK_DAY_END)) {
    return { error: `The end time must not pass ${WORK_DAY_END.slice(0, 5)} UK time — reduce the hours or start earlier.` };
  }
  return { label: `${toHhmmss(start)}–${toHhmmss(end)}` };
}
