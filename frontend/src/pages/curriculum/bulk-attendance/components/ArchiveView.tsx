import { useMemo, useState } from "react";
import type { AttendanceRow } from "./AttendanceTable";
import LearnerStatusBadge from "./LearnerStatusBadge";
import SearchBar from "./SearchBar";
import { avatarClass, getInitials } from "@/utils/bulkAttendance";

interface ArchiveViewProps {
  rows: AttendanceRow[];
  onOpenHistory: (row: AttendanceRow) => void;
}

export default function ArchiveView({ rows, onOpenHistory }: ArchiveViewProps) {
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
        <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-700">
          <i className="ri-archive-2-line text-base text-secondary-700" />
          <span className="font-medium text-foreground-950">
            {rows.length} {rows.length === 1 ? "learner" : "learners"}
          </span>
          <span className="hidden text-foreground-500 sm:inline">
            — Completed, EnteredEpa and Withdrawn learners are archived automatically.
          </span>
        </div>
        <SearchBar
          value={search}
          resultCount={visibleRows.length}
          onChange={setSearch}
        />
      </div>

      <div className="hidden items-center gap-4 border-b border-background-200 bg-background-100 px-5 py-3 md:flex">
        <span className="flex-1 font-label text-xs uppercase tracking-wide text-foreground-500">Learner</span>
        <span className="w-36 font-label text-xs uppercase tracking-wide text-foreground-500">Status</span>
        <span className="w-28 font-label text-xs uppercase tracking-wide text-foreground-500">Cohort</span>
        <span className="w-32 text-right font-label text-xs uppercase tracking-wide text-foreground-500">Details</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
            <i className="ri-archive-line text-2xl" />
          </span>
          <p className="text-sm font-medium text-foreground-950">
            Nothing archived
          </p>
          <p className="mt-1 max-w-sm text-sm text-foreground-500">
            Learners whose status is Completed, EnteredEpa or Withdrawn show up here.
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
        visibleRows.map((row) => {
          const { learner, index, cohortName } = row;
          return (
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
                  <button
                    type="button"
                    onClick={() => onOpenHistory(row)}
                    className="block cursor-pointer truncate text-left text-sm font-medium text-foreground-950 transition-colors hover:text-primary-700"
                  >
                    {learner.name}
                  </button>
                  <p className="truncate text-xs text-foreground-500">
                    {learner.email}
                  </p>
                </div>
              </div>

              <div className="md:w-36">
                <LearnerStatusBadge status={learner.status} />
              </div>

              <div className="md:w-28">
                <span className="truncate text-sm text-foreground-500">{cohortName}</span>
              </div>

              <div className="md:w-32 md:text-right">
                <button
                  type="button"
                  onClick={() => onOpenHistory(row)}
                  aria-label={`View details for ${learner.name}`}
                  className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-100"
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
