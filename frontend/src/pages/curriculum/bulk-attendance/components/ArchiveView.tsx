import { useMemo, useState } from "react";
import type { AttendanceRow } from "./AttendanceTable";
import SearchBar from "./SearchBar";
import { avatarClass, formatShortDate, getInitials } from "@/utils/bulkAttendance";

interface ArchiveViewProps {
  rows: AttendanceRow[];
  archivableCount: number;
  onArchive: () => void;
  onRestore: (learnerId: string) => void;
  onRestoreAll: () => void;
}

export default function ArchiveView({
  rows,
  archivableCount,
  onArchive,
  onRestore,
  onRestoreAll,
}: ArchiveViewProps) {
  const [search, setSearch] = useState("");

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      ({ learner }) =>
        learner.name.toLowerCase().includes(term) ||
        learner.email.toLowerCase().includes(term)
    );
  }, [rows, search]);

  return (
    <div className="overflow-hidden rounded-lg border border-background-300 bg-background-50">
      <div className="flex flex-col gap-3 border-b border-background-200 bg-background-100 px-5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-700">
            <i className="ri-archive-2-line text-base text-secondary-700" />
            <span className="font-medium text-foreground-950">
              {rows.length} {rows.length === 1 ? "learner" : "learners"}
            </span>
            <span className="hidden text-foreground-500 sm:inline">
              â€” restore anyone to bring them back, or archive more below.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onArchive}
              disabled={archivableCount === 0}
              className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ri-archive-line" />
              Archive learners
              {archivableCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-100 px-1.5 font-label text-xs text-warning-800">
                  {archivableCount}
                </span>
              )}
            </button>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={onRestoreAll}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200"
              >
                <i className="ri-arrow-go-back-line" />
                Restore all
              </button>
            )}
          </div>
        </div>
        <SearchBar
          value={search}
          resultCount={visibleRows.length}
          onChange={setSearch}
        />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
            <i className="ri-archive-line text-2xl" />
          </span>
          <p className="text-sm font-medium text-foreground-950">
            Nothing archived yet
          </p>
          <p className="mt-1 max-w-sm text-sm text-foreground-500">
            Learners past their end date are archived automatically and show up
            here. You can also archive anyone early with the button above.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
            <i className="ri-search-line text-2xl" />
          </span>
          <p className="text-sm font-medium text-foreground-950">
            No archived learners match
          </p>
          <p className="mt-1 max-w-sm text-sm text-foreground-500">
            Try a different name or email address.
          </p>
        </div>
      ) : (
        visibleRows.map(({ learner, index, groupName, cohortName }) => (
          <div
            key={learner.id}
            className="flex flex-col gap-3 border-b border-background-200 px-5 py-4 transition-colors last:border-b-0 hover:bg-background-100 md:flex-row md:items-center md:gap-4"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(
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
                  {learner.email}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 md:w-32">
              <span className="rounded-full bg-secondary-100 px-2.5 py-1 font-label text-xs text-secondary-900 md:hidden">
                {groupName}
              </span>
              <span className="hidden truncate text-sm text-foreground-700 md:block">
                {groupName}
              </span>
            </div>

            <div className="md:w-28">
              <span className="hidden truncate text-sm text-foreground-500 md:block">
                {cohortName}
              </span>
              <span className="rounded-full bg-background-200 px-2.5 py-1 font-label text-xs text-foreground-700 md:hidden">
                {cohortName}
              </span>
            </div>

            <div className="md:w-36">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-100 px-2.5 py-1 font-label text-xs text-warning-800">
                <i className="ri-calendar-line" />
                {formatShortDate(learner.endDate)}
              </span>
            </div>

            <div className="md:text-right">
              <button
                type="button"
                onClick={() => onRestore(learner.id)}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-primary-300 bg-primary-100 px-3 py-1.5 text-xs font-medium text-primary-800 transition-colors hover:bg-primary-200"
              >
                <i className="ri-arrow-go-back-line" />
                Restore
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

