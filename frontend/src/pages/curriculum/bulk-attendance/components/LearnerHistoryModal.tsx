import { useEffect, useMemo, useState } from "react";
import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";
import {
  avatarClass,
  formatDateLabel,
  getInitials,
} from "@/utils/bulkAttendance";

export interface LearnerHistoryRecord {
  id: string;
  source: "kbc" | "live";
  recordKey?: string;
  occurrenceId?: string;
  learnerProfileId?: string;
  sessionDate: string;
  moduleName: string;
  lectureName: string;
  attendance: AttendanceStatus;
}

interface LearnerHistoryModalProps {
  learner: Learner;
  index: number;
  moduleLabel: string;
  cohortName: string;
  history: LearnerHistoryRecord[];
  loading: boolean;
  error: string | null;
  onToggleAttendance: (entry: LearnerHistoryRecord) => Promise<void>;
  onClose: () => void;
}

function statusStyle(status: AttendanceStatus) {
  if (status === "present") {
    return {
      className: "border-green-200 bg-green-100 text-green-800",
      icon: "ri-check-line",
      label: "Present",
    };
  }
  if (status === "absent") {
    return {
      className: "border-red-200 bg-red-100 text-red-800",
      icon: "ri-close-line",
      label: "Absent",
    };
  }
  return {
    className: "border-background-300 bg-background-200 text-foreground-600",
    icon: "ri-subtract-line",
    label: "Unmarked",
  };
}

export default function LearnerHistoryModal({
  learner,
  index,
  moduleLabel,
  cohortName,
  history,
  loading,
  error,
  onToggleAttendance,
  onClose,
}: LearnerHistoryModalProps) {
  const [showStats, setShowStats] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<string[]>([]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const { present, absent, unmarked, rate } = useMemo(() => {
    const presentCount = history.filter((entry) => entry.attendance === "present").length;
    const absentCount = history.filter((entry) => entry.attendance === "absent").length;
    const markedCount = presentCount + absentCount;
    return {
      present: presentCount,
      absent: absentCount,
      unmarked: history.length - markedCount,
      rate: markedCount ? Math.round((presentCount / markedCount) * 100) : 0,
    };
  }, [history]);

  const rateClass =
    rate >= 80
      ? "text-green-700"
      : rate >= 50
      ? "text-warning-700"
      : "text-red-700";

  const handleToggleAttendance = async (entry: LearnerHistoryRecord) => {
    if (entry.attendance === "unmarked" || updatingIds.includes(entry.id)) return;
    setUpdatingIds((ids) => [...ids, entry.id]);
    try {
      await onToggleAttendance(entry);
    } finally {
      setUpdatingIds((ids) => ids.filter((id) => id !== entry.id));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/40 p-4"
      onClick={onClose}
    >
      <section
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-background-50 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learner-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-background-200 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(
                index
              )}`}
            >
              {getInitials(learner.name)}
            </span>
            <div className="min-w-0">
              <h3 id="learner-history-title" className="truncate text-base font-semibold text-foreground-950">
                {learner.name}
              </h3>
              <p className="truncate text-xs text-foreground-500">{learner.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-secondary-100 px-2 py-0.5 font-label text-xs text-secondary-900">
                  {moduleLabel || "All modules"}
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
              onClick={() => setShowStats((previous) => !previous)}
              aria-pressed={showStats}
              aria-label={showStats ? "Hide attendance stats" : "Show attendance stats"}
              title={showStats ? "Hide stats" : "Show stats"}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-400 transition-colors hover:bg-background-200 hover:text-foreground-800"
            >
              <i className={`text-lg ${showStats ? "ri-eye-line" : "ri-eye-off-line"}`} />
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
              <p className="font-label text-xs uppercase tracking-wide text-green-700">Present</p>
            </div>
            <div className="rounded-md bg-red-100 p-3 text-center">
              <p className="text-lg font-semibold text-red-700">{absent}</p>
              <p className="font-label text-xs uppercase tracking-wide text-red-700">Absent</p>
            </div>
            <div className="rounded-md bg-background-200 p-3 text-center">
              <p className="text-lg font-semibold text-foreground-700">{unmarked}</p>
              <p className="font-label text-xs uppercase tracking-wide text-foreground-500">Unmarked</p>
            </div>
            <div className="rounded-md bg-background-100 p-3 text-center">
              <p className={`text-lg font-semibold ${rateClass}`}>{rate}%</p>
              <p className="font-label text-xs uppercase tracking-wide text-foreground-500">Rate</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 pt-4">
          <div>
            <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
              All attendance records
            </p>
            <p className="mt-1 text-xs text-foreground-500">
              Click Present or Absent to switch the saved status.
            </p>
          </div>
          <span className="rounded-full bg-background-200 px-2.5 py-1 font-label text-xs text-foreground-700">
            {history.length} {history.length === 1 ? "session" : "sessions"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5" aria-live="polite">
          {error && (
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          {loading && history.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-500">Loading attendance history…</p>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-500">
              No attendance sessions are recorded for this learner.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((entry) => {
                const status = statusStyle(entry.attendance);
                const canToggle = entry.attendance === "present" || entry.attendance === "absent";
                const updating = updatingIds.includes(entry.id);
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-background-200 bg-background-100 px-3.5 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground-800">
                        {formatDateLabel(entry.sessionDate)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-foreground-700">
                        {entry.lectureName || "Lecture title not recorded"}
                      </span>
                      {entry.moduleName && (
                        <span className="mt-0.5 block truncate text-xs text-foreground-500">
                          Module: {entry.moduleName}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleToggleAttendance(entry)}
                      disabled={!canToggle || updating}
                      aria-label={canToggle ? `Change ${status.label.toLowerCase()} to ${entry.attendance === "present" ? "absent" : "present"}` : "Attendance is unmarked"}
                      title={canToggle ? `Change to ${entry.attendance === "present" ? "Absent" : "Present"}` : "Unmarked attendance cannot be switched"}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className} ${canToggle ? "cursor-pointer transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" : "cursor-not-allowed"} disabled:opacity-60`}
                    >
                      <i className={status.icon} />
                      {updating ? "Saving…" : status.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
