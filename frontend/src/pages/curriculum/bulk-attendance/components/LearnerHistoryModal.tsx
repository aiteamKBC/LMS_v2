import { useEffect, useMemo, useState } from "react";
import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";
import {
  avatarClass,
  formatDateLabel,
  getInitials,
} from "@/utils/bulkAttendance";
import type { EditableRecord } from "./AttendanceTable";
import LearnerStatusBadge from "./LearnerStatusBadge";
import { downloadLearnerAttendancePdf } from "../attendancePdf";

export interface LearnerHistoryRecord {
  id: string;
  /** Source record key: kbc_attendance."key", or "live:<id>" for the live register. */
  recordKey?: string;
  sessionDate: string;
  moduleName: string;
  lectureName: string;
  attendance: AttendanceStatus;
  source?: "kbc" | "live";
}

interface LearnerHistoryModalProps {
  learner: Learner;
  index: number;
  moduleLabel: string;
  cohortName: string;
  history: LearnerHistoryRecord[];
  loading: boolean;
  error: string | null;
  warnings?: string[];
  saving?: boolean;
  saveError?: string | null;
  /** Unsaved corrections across all learners; they survive closing this dialog. */
  pendingCount?: number;
  pendingStatus?: (source: "kbc" | "live", recordKey: string) => AttendanceStatus | undefined;
  onToggleRecord?: (record: EditableRecord) => void;
  onSave?: () => void;
  onDiscard?: () => void;
  onClose: () => void;
}

function statusStyle(status: AttendanceStatus) {
  if (status === "present") {
    return { className: "border-green-200 bg-green-100 text-green-800", icon: "ri-check-line", label: "Present" };
  }
  if (status === "absent") {
    return { className: "border-red-200 bg-red-100 text-red-800", icon: "ri-close-line", label: "Absent" };
  }
  return { className: "border-background-300 bg-background-200 text-foreground-600", icon: "ri-subtract-line", label: "Unmarked" };
}

function editableRecord(entry: LearnerHistoryRecord): EditableRecord | null {
  return entry.source && entry.recordKey
    ? { source: entry.source, recordKey: entry.recordKey, attendance: entry.attendance }
    : null;
}

export default function LearnerHistoryModal({
  learner,
  index,
  moduleLabel,
  cohortName,
  history,
  loading,
  error,
  warnings = [],
  saving = false,
  saveError = null,
  pendingCount = 0,
  pendingStatus,
  onToggleRecord,
  onSave,
  onDiscard,
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

  const statusOf = (entry: LearnerHistoryRecord): AttendanceStatus =>
    (entry.source && entry.recordKey && pendingStatus?.(entry.source, entry.recordKey)) || entry.attendance;

  const { present, absent, unmarked, rate } = useMemo(() => {
    const statuses = history.map((entry) =>
      (entry.source && entry.recordKey && pendingStatus?.(entry.source, entry.recordKey)) || entry.attendance);
    const presentCount = statuses.filter((status) => status === "present").length;
    const absentCount = statuses.filter((status) => status === "absent").length;
    const markedCount = presentCount + absentCount;
    return {
      present: presentCount,
      absent: absentCount,
      unmarked: history.length - markedCount,
      rate: markedCount ? Math.round((presentCount / markedCount) * 100) : 0,
    };
  }, [history, pendingStatus]);

  const rateClass = rate >= 80 ? "text-green-700" : rate >= 50 ? "text-warning-700" : "text-red-700";

  const handlePdfExport = () => {
    downloadLearnerAttendancePdf({
      learner,
      cohortName,
      moduleLabel,
      history: history.map((entry) => ({ ...entry, attendance: statusOf(entry) })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/40 p-4" onClick={onClose}>
      <section
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-background-50 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learner-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-background-200 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(index)}`}>
              {getInitials(learner.name)}
            </span>
            <div className="min-w-0">
              <h3 id="learner-history-title" className="truncate text-base font-semibold text-foreground-950">{learner.name}</h3>
              <p className="truncate text-xs text-foreground-500">{learner.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <LearnerStatusBadge status={learner.status} />
                <span className="rounded-full bg-secondary-100 px-2 py-0.5 font-label text-xs text-secondary-900">{moduleLabel || "All modules"}</span>
                {cohortName && cohortName !== "—" && (
                  <span className="rounded-full bg-background-200 px-2 py-0.5 font-label text-xs text-foreground-700">{cohortName}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handlePdfExport}
              disabled={loading}
              aria-label="Export learner attendance PDF"
              title="Export attendance PDF"
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary-200 px-2 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ri-file-pdf-2-line text-base" />
              <span className="hidden sm:inline">PDF</span>
            </button>
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
            <button type="button" onClick={onClose} aria-label="Close history" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-background-200 hover:text-foreground-900">
              <i className="ri-close-line text-lg" />
            </button>
          </div>
        </div>

        {showStats && (
          <div className="grid grid-cols-2 gap-2 border-b border-background-200 p-5 sm:grid-cols-4 sm:gap-3">
            <div className="rounded-md bg-green-100 p-3 text-center"><p className="text-lg font-semibold text-green-700">{present}</p><p className="font-label text-xs uppercase tracking-wide text-green-700">Present</p></div>
            <div className="rounded-md bg-red-100 p-3 text-center"><p className="text-lg font-semibold text-red-700">{absent}</p><p className="font-label text-xs uppercase tracking-wide text-red-700">Absent</p></div>
            <div className="rounded-md bg-background-200 p-3 text-center"><p className="text-lg font-semibold text-foreground-700">{unmarked}</p><p className="font-label text-xs uppercase tracking-wide text-foreground-500">Unmarked</p></div>
            <div className="rounded-md bg-background-100 p-3 text-center"><p className={`text-lg font-semibold ${rateClass}`}>{rate}%</p><p className="font-label text-xs uppercase tracking-wide text-foreground-500">Rate</p></div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 pt-4">
          <div>
            <p className="font-label text-xs uppercase tracking-wide text-foreground-500">All attendance records</p>
            <p className="mt-1 text-xs text-foreground-500">KBC history and the live session register. On a date both cover, the live register is shown. Click a status to change it, then Save.</p>
          </div>
          <span className="shrink-0 rounded-full bg-background-200 px-2.5 py-1 font-label text-xs text-foreground-700">
            {history.length} {history.length === 1 ? "session" : "sessions"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5" aria-live="polite">
          {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          {warnings.map((warning) => (
            <p key={warning} className="mb-3 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700" role="status">{warning}</p>
          ))}
          {loading && history.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-500">Loading attendance history…</p>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-500">No attendance records are stored for this learner.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((entry) => {
                const current = statusOf(entry);
                const status = statusStyle(current);
                const record = editableRecord(entry);
                const changed = current !== entry.attendance;
                return (
                  <li key={entry.id} className={`flex items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 ${changed ? "border-primary-300 bg-primary-50" : "border-background-200 bg-background-100"}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground-900">{entry.lectureName}</span>
                      <span className="mt-0.5 block text-xs text-foreground-700">{formatDateLabel(entry.sessionDate)}</span>
                      <span className="mt-0.5 block truncate text-xs text-foreground-500">Module: {entry.moduleName}</span>
                      {entry.source && (
                        <span className="mt-0.5 block text-xs text-foreground-400">
                          Source: {entry.source === "live" ? "Live register" : "KBC"}
                        </span>
                      )}
                    </span>
                    {record && onToggleRecord ? (
                      <button
                        type="button"
                        onClick={() => onToggleRecord(record)}
                        disabled={saving}
                        aria-label={`Change ${status.label.toLowerCase()} to ${current === "present" ? "absent" : "present"} for ${entry.lectureName}`}
                        title="Click to change"
                        className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-shadow hover:ring-2 hover:ring-primary-200 disabled:cursor-not-allowed disabled:opacity-60 ${status.className}`}
                      >
                        <i className={status.icon} />
                        {status.label}
                      </button>
                    ) : (
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}>
                        <i className={status.icon} />
                        {status.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {(pendingCount > 0 || saveError) && (
          <footer className="border-t border-background-200 bg-background-100 px-5 py-3">
            {saveError && <p className="mb-2 text-sm text-red-700" role="alert">{saveError}</p>}
            {pendingCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-foreground-700">
                  {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onDiscard}
                    disabled={saving}
                    className="cursor-pointer rounded-md border border-background-300 bg-background-50 px-3 py-1.5 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary-500 px-3 py-1.5 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <i className="ri-save-3-line" />
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
