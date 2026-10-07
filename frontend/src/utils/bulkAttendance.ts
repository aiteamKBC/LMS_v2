export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_PALETTE = [
  "bg-primary-100 text-primary-700",
  "bg-accent-100 text-accent-700",
  "bg-secondary-100 text-secondary-900",
  "bg-primary-200 text-primary-800",
  "bg-accent-200 text-accent-800",
];

export function avatarClass(index: number): string {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

export function formatDateLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Shifts an ISO date by a number of days (negative moves backwards). */
export function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Whether a learner's enrolment end date has arrived or already passed. */
export function isPastEndDate(endDate: string | undefined, today: string): boolean {
  if (!endDate) return false;
  return endDate <= today;
}

/** Human-friendly short date, e.g. "Dec 20, 2025". */
export function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Inclusive list of ISO dates between start and end (capped at 366 days). */
export function getDateRange(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  const days: string[] = [];
  const cursor = new Date(from);
  let guard = 0;
  while (cursor <= to && guard < 366) {
    days.push(toIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return days;
}

export interface WeekDay {
  iso: string;
  weekday: string;
  dayNum: string;
}

/** Returns the Monday-to-Sunday week that contains the given ISO date. */
export function getWeekDays(iso: string): WeekDay[] {
  const base = new Date(`${iso}T00:00:00`);
  const valid = !Number.isNaN(base.getTime());
  const anchor = valid ? base : new Date();
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - mondayOffset);

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const dayNum = String(d.getDate()).padStart(2, "0");
    days.push({
      iso: `${year}-${month}-${dayNum}`,
      weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: String(d.getDate()),
    });
  }
  return days;
}
