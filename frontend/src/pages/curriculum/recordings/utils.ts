import type { Lecture, RecordingStatus } from "@/pages/curriculum/recordings/types";

// Use the device zone by default. Outlook can use a different account zone, so
// the calendar also offers explicit zones without ever applying a fixed offset.
export const TIME_ZONE_LABEL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
export const CALENDAR_TIME_ZONES = [...new Set([TIME_ZONE_LABEL, 'Africa/Cairo', 'Europe/London', 'UTC'])];
export function todayIso(timeZone = TIME_ZONE_LABEL) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export const DAY_START_MINUTES = 7 * 60;
export const DAY_END_MINUTES = 20 * 60;
export const HOUR_HEIGHT = 64;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const STATUS_META_MAP: Record<
  RecordingStatus,
  {
    label: string;
    icon: string;
    dotClass: string;
    badgeClass: string;
    borderLeft: string;
    textClass: string;
    description: string;
  }
> = {
  ready: {
    label: "Ready",
    icon: "ri-checkbox-circle-fill",
    dotClass: "bg-accent-500",
    badgeClass: "border-accent-200 bg-accent-100 text-accent-900",
    borderLeft: "border-accent-500",
    textClass: "text-accent-800",
    description: "Saved file is available in the archive.",
  },
  review: {
    label: "Review placement",
    icon: "ri-error-warning-line",
    dotClass: "bg-amber-500",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
    borderLeft: "border-amber-500",
    textClass: "text-amber-800",
    description: "The saved Teams recording needs its lecture date checked.",
  },
  pending: {
    label: "Processing",
    icon: "ri-time-line",
    dotClass: "bg-amber-500",
    badgeClass: "border-amber-200 bg-amber-100 text-amber-900",
    borderLeft: "border-amber-500",
    textClass: "text-amber-800",
    description: "Still being processed. No file is available yet.",
  },
  missing: {
    label: "Not recorded",
    icon: "ri-error-warning-fill",
    dotClass: "bg-rose-500",
    badgeClass: "border-rose-200 bg-rose-100 text-rose-900",
    borderLeft: "border-rose-500",
    textClass: "text-rose-800",
    description: "No recording file was captured for this session.",
  },
  unsynced: {
    label: "Awaiting sync",
    icon: "ri-cloud-off-line",
    dotClass: "bg-secondary-500",
    badgeClass: "border-secondary-200 bg-secondary-100 text-secondary-900",
    borderLeft: "border-secondary-400",
    textClass: "text-secondary-800",
    description: "Results have not been confirmed by a completed synchronization.",
  },
  archiveFailed: {
    label: "Archive failed",
    icon: "ri-error-warning-line",
    dotClass: "bg-rose-500",
    badgeClass: "border-rose-200 bg-rose-100 text-rose-900",
    borderLeft: "border-rose-500",
    textClass: "text-rose-800",
    description: "The recording exists, but its saved archive copy failed.",
  },
  upcoming: {
    label: "Coming soon",
    icon: "ri-calendar-event-line",
    dotClass: "bg-slate-400",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-700",
    borderLeft: "border-slate-400",
    textClass: "text-slate-600",
    description: "This session has not finished and synchronized yet.",
  },
  inProgress: {
    label: "In progress",
    icon: "ri-live-line",
    dotClass: "bg-primary-500",
    badgeClass: "border-primary-200 bg-primary-50 text-primary-800",
    borderLeft: "border-primary-500",
    textClass: "text-primary-700",
    description: "This session is still running.",
  },
  cancelled: {
    label: "Cancelled",
    icon: "ri-calendar-close-line",
    dotClass: "bg-slate-400",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-700",
    borderLeft: "border-slate-400",
    textClass: "text-slate-600",
    description: "This session was cancelled.",
  },
  planned: {
    label: "LMS plan",
    icon: "ri-calendar-todo-line",
    dotClass: "bg-violet-400",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-800",
    borderLeft: "border-violet-400",
    textClass: "text-violet-700",
    description: "An authored LMS slot has no confirmed Teams occurrence linked to it.",
  },
  unavailable: {
    label: "No saved recording",
    icon: "ri-video-off-line",
    dotClass: "bg-slate-400",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-700",
    borderLeft: "border-slate-400",
    textClass: "text-slate-600",
    description: "No saved recording is linked to this session.",
  },
};

export const STATUS_META = STATUS_META_MAP;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function addDays(iso: string, delta: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function weekdayIndex(iso: string): number {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function formatFullDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso);
  return `${WEEKDAY_LONG[weekdayIndex(iso)]}, ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatCompactDate(iso: string): string {
  const { month, day } = parseIsoDate(iso);
  return `${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function timeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatTimeRange(start: string, end: string): string {
  return start === end ? start : `${start}\u2013${end}`;
}

export function formatHourLabel(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:00`;
}

/** Monday-first month grid, always 42 cells. */
export function getMonthMatrix(year: number, month: number): string[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: string[] = [];

  for (let i = 0; i < leading; i += 1) {
    const date = new Date(Date.UTC(year, month - 1, 1 - (leading - i)));
    cells.push(toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()));
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIsoDate(year, month, day));
  }

  let overflow = 1;
  while (cells.length < 42) {
    const date = new Date(Date.UTC(year, month, overflow));
    cells.push(toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()));
    overflow += 1;
  }

  return cells;
}

export interface PositionedLecture {
  lecture: Lecture;
  col: number;
  cols: number;
  top: number;
  height: number;
}

/**
 * Places lectures on a vertical time grid and spreads overlapping sessions
 * across equal-width columns so titles stay readable.
 */
export function layoutDayLectures(
  lectures: Lecture[],
  dayStartMinutes: number,
  hourHeight: number,
): PositionedLecture[] {
  const events = lectures
    .map((lecture) => {
      const start = timeToMinutes(lecture.startTime);
      const rawEnd = timeToMinutes(lecture.endTime);
      return { lecture, start, end: Math.max(rawEnd, start + 30) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const positioned: PositionedLecture[] = [];
  let cluster: typeof events = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const assignments: { lecture: Lecture; start: number; end: number; col: number }[] = [];

    cluster.forEach((event) => {
      let col = columnEnds.findIndex((end) => end <= event.start);
      if (col === -1) {
        columnEnds.push(event.end);
        col = columnEnds.length - 1;
      } else {
        columnEnds[col] = event.end;
      }
      assignments.push({ lecture: event.lecture, start: event.start, end: event.end, col });
    });

    const total = Math.max(columnEnds.length, 1);
    assignments.forEach((item) => {
      positioned.push({
        lecture: item.lecture,
        col: item.col,
        cols: total,
        top: ((item.start - dayStartMinutes) / 60) * hourHeight,
        height: Math.max(((item.end - item.start) / 60) * hourHeight, 42),
      });
    });

    cluster = [];
    clusterEnd = -Infinity;
  };

  events.forEach((event) => {
    if (cluster.length > 0 && event.start >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.end);
  });
  flush();

  return positioned;
}

export function lectureReadyCount(lecture: Lecture): number {
  return lecture.recordings.filter((recording) => recording.status === "ready").length;
}

export function lectureHasAllReady(lecture: Lecture): boolean {
  return lecture.recordings.length > 0 && lecture.recordings.every((r) => r.status === "ready");
}

export function lectureNeedsAttention(lecture: Lecture): boolean {
  return !['upcoming', 'inProgress', 'cancelled', 'planned', 'unavailable', 'ready'].includes(lecture.status)
    || lecture.recordings.some(recording => recording.status !== 'ready');
}

export function lectureOverallStatus(lecture: Lecture): RecordingStatus {
  if (lecture.status === 'review' && lectureHasAllReady(lecture)) return 'review';
  const statuses = lecture.recordings.map((recording) => recording.status);
  if (statuses.length === 0) return lecture.status;
  if (statuses.every((status) => status === "ready")) return "ready";
  if (statuses.includes("archiveFailed")) return "archiveFailed";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("pending")) return "pending";
  return "unsynced";
}

export function lectureStatusSummary(lecture: Lecture): string {
  if (lecture.status === 'review' && lectureHasAllReady(lecture)) {
    return lecture.recordings.length === 1 ? 'Recording needs date review' : 'Recordings need date review';
  }
  const total = lecture.recordings.length;
  if (total === 0) return STATUS_META[lecture.status].label;
  const ready = lectureReadyCount(lecture);
  if (ready === total) {
    return total === 1 ? "Recording ready" : `${total} recordings ready`;
  }
  return `${ready} of ${total} ready`;
}
