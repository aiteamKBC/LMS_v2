import type { AttendanceStatus } from "@/types/bulkAttendance";
import type { WeekDay } from "@/utils/bulkAttendance";
import { avatarClass, getInitials } from "@/utils/bulkAttendance";
import type { AttendanceRow } from "./AttendanceTable";

interface WeeklyGridProps {
  rows: AttendanceRow[];
  days: WeekDay[];
  today: string;
  loading: boolean;
  getStatus: (learnerId: string, day: string) => AttendanceStatus;
  onToggle: (learnerId: string, day: string) => void;
}

function GridSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-background-200" />
          <div className="h-3 w-40 animate-pulse rounded bg-background-200" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 7 }).map((__, j) => (
              <div
                key={j}
                className="h-8 w-8 animate-pulse rounded-md bg-background-100"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WeeklyGrid({
  rows,
  days,
  today,
  loading,
  getStatus,
  onToggle,
}: WeeklyGridProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-background-300 bg-background-50">
        <GridSkeleton />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-background-300 bg-background-50 px-6 py-14 text-center">
        <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
          <i className="ri-calendar-2-line text-2xl" />
        </span>
        <p className="text-sm font-medium text-foreground-950">
          Nothing to show for this week
        </p>
        <p className="mt-1 max-w-sm text-sm text-foreground-500">
          Adjust the filters or search to load learners into the weekly grid.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-background-300 bg-background-50">
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-background-200 bg-background-100">
            <th className="sticky left-0 z-10 bg-background-100 px-5 py-3 text-left font-label text-xs uppercase tracking-wide text-foreground-500">
              Learner
            </th>
            {days.map((day) => {
              const isToday = day.iso === today;
              return (
                <th
                  key={day.iso}
                  className={`px-2 py-3 text-center font-label text-xs uppercase tracking-wide ${
                    isToday ? "text-primary-700" : "text-foreground-500"
                  }`}
                >
                  <span className="block">{day.weekday}</span>
                  <span
                    className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isToday
                        ? "bg-primary-500 text-background-50"
                        : "text-foreground-700"
                    }`}
                  >
                    {day.dayNum}
                  </span>
                </th>
              );
            })}
            <th className="px-5 py-3 text-right font-label text-xs uppercase tracking-wide text-foreground-500">
              Week
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ learner, index, groupName }) => {
            const weekPresent = days.filter(
              (day) => getStatus(learner.id, day.iso) === "present"
            ).length;
            const rate = Math.round((weekPresent / days.length) * 100);
            return (
              <tr
                key={learner.id}
                className="border-b border-background-200 last:border-b-0 hover:bg-background-100"
              >
                <td className="sticky left-0 z-10 bg-background-50 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClass(
                        index
                      )}`}
                    >
                      {getInitials(learner.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground-950">
                        {learner.name}
                      </p>
                      <p className="truncate text-xs text-foreground-500">
                        {groupName}
                      </p>
                    </div>
                  </div>
                </td>
                {days.map((day) => {
                  const status = getStatus(learner.id, day.iso);
                  const isToday = day.iso === today;
                  const isPresent = status === "present";
                  const isAbsent = status === "absent";
                  const cellClass = isPresent
                    ? "border-green-200 bg-green-100 text-green-700 hover:bg-green-200"
                    : isAbsent
                    ? "border-red-200 bg-red-100 text-red-700 hover:bg-red-200"
                    : "border-background-300 bg-background-100 text-foreground-500 hover:bg-background-200";
                  const cellIcon = isPresent
                    ? "ri-check-line"
                    : isAbsent
                    ? "ri-close-line"
                    : "ri-subtract-line";
                  return (
                    <td key={day.iso} className="px-2 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => onToggle(learner.id, day.iso)}
                        aria-label={`${learner.name} ${day.iso} ${status}`}
                        className={`mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-sm transition-colors ${cellClass} ${
                          isToday ? "ring-2 ring-primary-300" : ""
                        }`}
                      >
                        <i className={cellIcon} />
                      </button>
                    </td>
                  );
                })}
                <td className="px-5 py-3 text-right">
                  <span
                    className={`text-sm font-semibold ${
                      rate >= 80
                        ? "text-green-700"
                        : rate >= 50
                        ? "text-warning-700"
                        : "text-red-700"
                    }`}
                  >
                    {rate}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

