// UK working-calendar rules for the employee-arranged journal.
//
// Activity dates must land inside the report month being edited, on a working
// day: UK weekends (Saturday/Sunday) and England & Wales bank holidays are
// blocked. The ledger closes at August 2026 (see the backend's
// LEDGER_END_MONTH) so the holiday table only needs to cover these years.

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
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

/** First/last day of a "YYYY-MM" month, for date-input min/max. */
export function monthBounds(month: string): { min: string; max: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
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

export const WORK_DAY_START = "09:00";
export const WORK_DAY_END = "17:00";

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function toHhmm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * System-generated timestamp for claimed hours inside legal job hours
 * (09:00–17:00). Returns "HH:MM–HH:MM", or an error string when the claimed
 * hours cannot fit before 17:00.
 */
export function workingTimeRange(startHhmm: string, actualHours: number): { label: string } | { error: string } {
  if (!Number.isFinite(actualHours) || actualHours <= 0) {
    return { error: "Enter the actual (claimed) hours first — the timestamp is generated from them." };
  }
  const start = toMinutes(startHhmm || WORK_DAY_START);
  if (start < toMinutes(WORK_DAY_START)) return { error: "The start time cannot be before 09:00." };
  const end = start + Math.round(actualHours * 60);
  if (end > toMinutes(WORK_DAY_END)) {
    return { error: "The end time must not pass 17:00 — reduce the hours or start earlier." };
  }
  return { label: `${toHhmm(start)}–${toHhmm(end)}` };
}
