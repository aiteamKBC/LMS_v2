import { useEffect, useMemo, useState } from "react";
import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";
import {
  avatarClass,
  formatDateLabel,
  getDateRange,
  getInitials,
  shiftIso,
} from "@/utils/bulkAttendance";

interface LearnerHistoryModalProps {
  learner: Learner;
  index: number;
  groupName: string;
  cohortName: string;
  moduleLabel: string;
  anchorDate: string;
  lectureNameByDate?: Record<string, string>;
  getStatus: (learnerId: string, day: string) => AttendanceStatus;
  onToggleStatus: (day: string, status: AttendanceStatus) => void;
  dirty: boolean;
  pendingCount: number;
  onSave: () => void;
  onUndo: () => void;
  onClose: () => void;
}

const HISTORY_DAYS = 30;

export default function LearnerHistoryModal({
  learner,
  index,
  groupName,
  cohortName,
  moduleLabel,
  anchorDate,
  lectureNameByDate = {},
  getStatus,
  onToggleStatus,
  dirty,
  pendingCount,
  onSave,
  onUndo,
  onClose,
}: LearnerHistoryModalProps) {
  const [showStats, setShowStats] = useState(true);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const history = useMemo(() => {
    const range = getDateRange(
      shiftIso(anchorDate, -(HISTORY_DAYS - 1)),
      anchorDate
    );
    return range
      .map((iso) => ({ iso, status: getStatus(learner.id, iso) }))
      .reverse();
  }, [anchorDate, getStatus, learner.id]);

  const present = history.filter((entry) => entry.status === "present").length;
  const absent = history.filter((entry) => entry.status === "absent").length;
  const unmarked = history.length - present - absent;
  const marked = present + absent;
  const rate = marked ? Math.round((present / marked) * 100) : 0;

  const rateClass =
    rate >= 80
      ? "text-green-700"
      : rate >= 50
      ? "text-warning-700"
      : "text-red-700";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/40 p-4"
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-background-50"
        role="presentation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-background-200 p-5">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(
                index
              )}`}
            >
              {getInitials(learner.name)}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground-950">
                {learner.name}
              </h3>
              <p className="truncate text-xs text-foreground-500">
                {learner.email}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-secondary-100 px-2 py-0.5 font-label text-xs text-secondary-900">
                  {groupName}
                </span>
                <span className="rounded-full bg-background-200 px-2 py-0.5 font-label text-xs text-foreground-700">
                  {cohortName}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setShowStats((prev) => !prev)}
              aria-pressed={showStats}
              aria-label={
                showStats
                  ? "Hide attendance stats"
                  : "Show attendance stats"
              }
              title={showStats ? "Hide stats" : "Show stats"}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-400 transition-colors hover:bg-background-200 hover:text-foreground-800"
            >
              <i
                className={`text-lg ${
                  showStats ? "ri-eye-line" : "ri-eye-off-line"
                }`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close history"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-background-200 hover:text-foreground-900"
            >
              <i className="ri-close-line text-lg" />
            </button>
          </div>
        </div>

        {showStats && (
        <div className="grid grid-cols-2 gap-2 border-b border-background-200 p-5 sm:grid-cols-4 sm:gap-3">
          <div className="rounded-md bg-green-100 p-3 text-center">
            <p className="text-lg font-semibold text-green-700">{present}</p>
            <p className="font-label text-xs uppercase tracking-wide text-green-700">
              Present
            </p>
          </div>
          <div className="rounded-md bg-red-100 p-3 text-center">
            <p className="text-lg font-semibold text-red-700">{absent}</p>
            <p className="font-label text-xs uppercase tracking-wide text-red-700">
              Absent
            </p>
          </div>
          <div className="rounded-md bg-background-200 p-3 text-center">
            <p className="text-lg font-semibold text-foreground-700">
              {unmarked}
            </p>
            <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
              Unmarked
            </p>
          </div>
          <div className="rounded-md bg-background-100 p-3 text-center">
            <p className={`text-lg font-semibold ${rateClass}`}>{rate}%</p>
            <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
              Rate
            </p>
          </div>
        </div>
        )}

        <div className="flex items-center justify-between px-5 pt-4">
          <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
            Last {HISTORY_DAYS} days
          </p>
          <span className="rounded-full bg-background-200 px-2.5 py-1 font-label text-xs text-foreground-700">
            {moduleLabel}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <ul className="space-y-2">
            {history.map((entry) => {
              const isPresent = entry.status === "present";
              const isAbsent = entry.status === "absent";
              const pillClass = isPresent
                ? "border-green-200 bg-green-100 text-green-800 hover:bg-green-200"
                : isAbsent
                ? "border-red-200 bg-red-100 text-red-800 hover:bg-red-200"
                : "border-background-300 bg-background-200 text-foreground-600 hover:bg-background-300";
              const pillIcon = isPresent
                ? "ri-check-line"
                : isAbsent
                ? "ri-close-line"
                : "ri-subtract-line";
              const pillText = isPresent
                ? "Present"
                : isAbsent
                ? "Absent"
                : "â€”";
              const pillLabel = isPresent
                ? "present"
                : isAbsent
                ? "absent"
                : "unmarked";
              return (
                <li
                  key={entry.iso}
                  className="flex items-center justify-between rounded-md border border-background-200 bg-background-100 px-3.5 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground-800">
                      {formatDateLabel(entry.iso)}
                    </span>
                    {lectureNameByDate[entry.iso] && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-foreground-500">
                        <i className="ri-presentation-line" />
                        {lectureNameByDate[entry.iso]}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleStatus(
                        entry.iso,
                        isPresent ? "absent" : "present"
                      )
                    }
                    title="Click to switch status"
                    aria-label={`${formatDateLabel(
                      entry.iso
                    )} is ${pillLabel}, click to change`}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${pillClass}`}
                  >
                    <i className={pillIcon} />
                    {pillText}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {dirty && (
          <div className="flex flex-col gap-3 border-t border-background-200 bg-background-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
                <i className="ri-edit-2-line" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-medium text-foreground-950">
                  Unsaved changes
                </p>
                <p className="text-xs text-foreground-500">
                  {pendingCount} change{pendingCount === 1 ? "" : "s"} not saved
                  yet
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onUndo}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200"
              >
                <i className="ri-arrow-go-back-line" />
                Undo
              </button>
              <button
                type="button"
                onClick={onSave}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600"
              >
                <i className="ri-save-3-line" />
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

