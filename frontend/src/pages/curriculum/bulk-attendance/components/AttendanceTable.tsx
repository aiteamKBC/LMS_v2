import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";
import { avatarClass, formatShortDate, getInitials } from "@/utils/bulkAttendance";

export interface AttendanceRow {
  learner: Learner;
  index: number;
  cohortName: string;
}

export interface RecentLecture {
  id: string;
  name: string;
  sessionDate: string;
  status: AttendanceStatus;
}

export interface LectureInfo {
  name: string;
  moduleName: string;
  date: string | null;
  recent: RecentLecture[];
}

interface AttendanceTableProps {
  rows: AttendanceRow[];
  loading: boolean;
  selectedIds: string[];
  lectureInfo: Record<string, LectureInfo>;
  onToggleSelect: (learnerId: string) => void;
  onToggleSelectAll: () => void;
  onOpenHistory: (row: AttendanceRow) => void;
}

function formatBadgeDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-background-200 px-5 py-4 last:border-b-0"
        >
          <div className="h-5 w-5 animate-pulse rounded bg-background-200" />
          <div className="h-10 w-10 animate-pulse rounded-full bg-background-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-background-200" />
            <div className="h-3 w-56 animate-pulse rounded bg-background-100" />
          </div>
          <div className="h-8 w-32 animate-pulse rounded-full bg-background-200" />
        </div>
      ))}
    </>
  );
}

export default function AttendanceTable({
  rows,
  loading,
  selectedIds,
  lectureInfo,
  onToggleSelect,
  onToggleSelectAll,
  onOpenHistory,
}: AttendanceTableProps) {
  const allSelected =
    rows.length > 0 && rows.every((row) => selectedIds.includes(row.learner.id));

  return (
    <div className="overflow-hidden rounded-lg border border-background-300 bg-background-50">
      <div className="hidden items-center gap-4 border-b border-background-200 bg-background-100 px-5 py-3 md:flex">
        <button
          type="button"
          onClick={onToggleSelectAll}
          aria-pressed={allSelected}
          aria-label="Select all learners"
          className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border text-xs transition-colors ${
            allSelected
              ? "border-primary-500 bg-primary-500 text-background-50"
              : "border-background-400 bg-background-50 text-transparent"
          }`}
        >
          <i className="ri-check-line" />
        </button>
        <span className="flex-1 font-label text-xs uppercase tracking-wide text-foreground-500">
          Learner
        </span>
        <span className="w-44 whitespace-nowrap font-label text-xs uppercase tracking-wide text-foreground-500">
          Lecture
        </span>
        <span className="w-56 whitespace-nowrap font-label text-xs uppercase tracking-wide text-foreground-500">
          Last 4 lectures
        </span>
        <span className="w-36 font-label text-xs uppercase tracking-wide text-foreground-500">
          Module
        </span>
        <span className="w-24 font-label text-xs uppercase tracking-wide text-foreground-500">
          Cohort
        </span>
        <span className="w-40 text-right font-label text-xs uppercase tracking-wide text-foreground-500">
          Details
        </span>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
            <i className="ri-user-search-line text-2xl" />
          </span>
          <p className="text-sm font-medium text-foreground-950">
            No learners found
          </p>
          <p className="mt-1 max-w-sm text-sm text-foreground-500">
            Try a different programme, cohort, group, module, or search term.
          </p>
        </div>
      ) : (
        rows.map(({ learner, index, cohortName }) => {
          const selected = selectedIds.includes(learner.id);
          const info = lectureInfo[learner.id];
          const recent = info?.recent ?? [];
          return (
            <div
              key={learner.id}
              className={`flex flex-col gap-3 border-b border-background-200 px-5 py-4 transition-colors last:border-b-0 md:flex-row md:items-center md:gap-4 ${
                selected ? "bg-primary-50" : "hover:bg-background-100"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  type="button"
                  onClick={() => onToggleSelect(learner.id)}
                  aria-pressed={selected}
                  aria-label={`Select ${learner.name}`}
                  className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border text-xs transition-colors ${
                    selected
                      ? "border-primary-500 bg-primary-500 text-background-50"
                      : "border-background-400 bg-background-50 text-transparent"
                  }`}
                >
                  <i className="ri-check-line" />
                </button>
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(
                    index
                  )}`}
                >
                  {getInitials(learner.name)}
                </span>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenHistory({ learner, index, cohortName })}
                    className="flex cursor-pointer items-center gap-1.5 truncate text-left text-sm font-medium text-foreground-950 transition-colors hover:text-primary-700"
                  >
                    <span className="truncate">{learner.name}</span>
                    <i className="ri-history-line shrink-0 text-xs text-foreground-400" />
                  </button>
                  <p className="truncate text-xs text-foreground-500">
                    {learner.email}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 md:block md:w-44">
                <span className="font-label text-xs uppercase tracking-wide text-foreground-500 md:hidden">
                  Lecture
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground-800">
                    {info?.name ?? "—"}
                  </span>
                  {info?.date && (
                    <span className="hidden text-xs text-foreground-500 md:block">
                      {formatShortDate(info.date)}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-start gap-2 md:w-56">
                <span className="font-label text-xs uppercase tracking-wide text-foreground-500 md:hidden">
                  Last 4
                </span>
                <span className="flex items-start gap-1.5">
                  {recent.length === 0 ? (
                    <span className="text-xs text-foreground-400">—</span>
                  ) : (
                    recent.map((lecture) => {
                      const isPresent = lecture.status === "present";
                      const isAbsent = lecture.status === "absent";
                      const badgeClass = isPresent
                        ? "bg-green-100 text-green-700"
                        : isAbsent
                        ? "bg-red-100 text-red-700"
                        : "bg-background-200 text-foreground-500";
                      const badgeIcon = isPresent
                        ? "ri-check-line"
                        : isAbsent
                        ? "ri-close-line"
                        : "ri-subtract-line";
                      const badgeLabel = isPresent
                        ? "Present"
                        : isAbsent
                        ? "Absent"
                        : "Unmarked";
                      return (
                        <span
                          key={lecture.id}
                          className="flex w-10 flex-col items-center gap-1"
                        >
                          <span
                            title={`${lecture.name} • ${formatShortDate(
                              lecture.sessionDate
                            )} • ${badgeLabel}`}
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs ${badgeClass}`}
                          >
                            <i className={badgeIcon} />
                          </span>
                          <span className="whitespace-nowrap text-[10px] leading-none text-foreground-500">
                            {formatBadgeDate(lecture.sessionDate)}
                          </span>
                        </span>
                      );
                    })
                  )}
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-2 md:w-36">
                <span className="font-label text-xs uppercase tracking-wide text-foreground-500 md:hidden">
                  Module
                </span>
                <span className="truncate text-sm text-foreground-700">
                  {info?.moduleName || "—"}
                </span>
              </div>

              <div className="flex items-center gap-2 md:w-24">
                <span className="hidden truncate text-sm text-foreground-500 md:block">
                  {cohortName}
                </span>
                <span className="rounded-full bg-background-200 px-2.5 py-1 font-label text-xs text-foreground-700 md:hidden">
                  {cohortName}
                </span>
              </div>

              <div className="md:w-40 md:text-right">
                <button
                  type="button"
                  onClick={() => onOpenHistory({ learner, index, cohortName })}
                  aria-label={`View details for ${learner.name}`}
                  className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                  <i className="ri-eye-line" />
                  View details
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

