import { useEffect, useMemo, useState } from "react";
import type { AttendanceStatus } from "@/types/bulkAttendance";

export type AddAttendanceScope = "selected" | "filtered";

export interface AddAttendanceDayValues {
  date: string;
  lectureId: string;
  status: Extract<AttendanceStatus, "present" | "absent">;
  scope: AddAttendanceScope;
}

export interface AddAttendanceLectureOption {
  id: string;
  name: string;
  moduleName: string;
  moduleCatalogueId?: string;
  sessionDate: string;
}

interface AddAttendanceDayDialogProps {
  initialDate: string;
  initialLectureId: string;
  lectures: AddAttendanceLectureOption[];
  selectedCount: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: AddAttendanceDayValues) => void;
}

export default function AddAttendanceDayDialog({
  initialDate,
  initialLectureId,
  lectures,
  selectedCount,
  saving,
  error,
  onClose,
  onSave,
}: AddAttendanceDayDialogProps) {
  const [date, setDate] = useState(initialDate);
  const [lectureId, setLectureId] = useState(initialLectureId);
  const [status, setStatus] = useState<AddAttendanceDayValues["status"]>("present");
  const [scope, setScope] = useState<AddAttendanceScope>(
    selectedCount > 0 ? "selected" : "filtered",
  );
  const dateLectures = useMemo(
    () => lectures.filter((lecture) => lecture.sessionDate === date),
    [date, lectures],
  );
  const selectedLecture = dateLectures.find((lecture) => lecture.id === lectureId);
  const liveSessionReady = Boolean(selectedLecture?.moduleCatalogueId);
  const selectedAvailable = liveSessionReady && selectedCount > 0;
  const filteredAvailable = liveSessionReady;
  const canSave = Boolean(date && lectureId) && (scope === "selected" ? selectedAvailable : filteredAvailable);

  useEffect(() => {
    if (!dateLectures.some((lecture) => lecture.id === lectureId)) {
      setLectureId(dateLectures.length === 1 ? dateLectures[0].id : "");
    }
  }, [dateLectures, lectureId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/35 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-attendance-day-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-background-300 bg-background-50 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div>
            <p className="font-label text-xs uppercase tracking-wide text-primary-700">
              Bulk attendance
            </p>
            <h3 id="add-attendance-day-title" className="mt-1 text-lg font-semibold text-foreground-950">
              Add attendance day
            </h3>
            <p className="mt-1 text-sm text-foreground-500">
              Choose a scheduled live session and add one attendance result.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close add attendance day"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-foreground-500 transition-colors hover:bg-background-200 hover:text-foreground-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="ri-close-line text-xl" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {!lectures.length && (
            <p role="status" className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800">
              No live sessions match the current programme, cohort, group or module filters.
            </p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground-800">Live session date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={saving}
              className="h-11 w-full cursor-pointer rounded-lg border border-background-300 bg-background-50 px-3 text-sm text-foreground-950 outline-none transition-colors focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground-800">Live session</span>
            <select
              aria-label="Live session"
              value={lectureId}
              onChange={(event) => setLectureId(event.target.value)}
              disabled={saving || dateLectures.length === 0}
              className="h-11 w-full cursor-pointer rounded-lg border border-background-300 bg-background-50 px-3 text-sm text-foreground-950 outline-none transition-colors focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {dateLectures.length ? "Choose a live session" : "No live sessions on this date"}
              </option>
              {dateLectures.map((lecture) => (
                <option key={lecture.id} value={lecture.id}>
                  {lecture.name} — {lecture.moduleName}
                </option>
              ))}
            </select>
            {lectures.length > 0 && dateLectures.length === 0 && (
              <span className="mt-1.5 block text-xs text-foreground-500">
                This filter combination has no scheduled live session on the selected date.
              </span>
            )}
          </label>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-foreground-800">Attendance status</legend>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["present", "Present", "ri-check-line", "border-green-300 bg-green-50 text-green-800"],
                ["absent", "Absent", "ri-close-line", "border-red-300 bg-red-50 text-red-800"],
              ] as const).map(([value, label, icon, activeClass]) => {
                const selected = status === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatus(value)}
                    aria-pressed={selected}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      selected ? activeClass : "border-background-300 bg-background-50 text-foreground-600 hover:bg-background-100"
                    }`}
                  >
                    <i className={icon} />
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-foreground-800">Apply to</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setScope("selected")}
                disabled={!selectedAvailable}
                aria-pressed={scope === "selected"}
                className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  scope === "selected"
                    ? "border-primary-400 bg-primary-50"
                    : "border-background-300 bg-background-50 hover:bg-background-100"
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground-900">
                  Selected learners
                  <i className="ri-user-follow-line text-primary-700" />
                </span>
                <span className="mt-1 block text-xs text-foreground-500">
                  {selectedAvailable
                    ? `${selectedCount} selected in the register`
                    : liveSessionReady ? "Select one or more learners first" : "Choose a live session first"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setScope("filtered")}
                disabled={!filteredAvailable}
                aria-pressed={scope === "filtered"}
                className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  scope === "filtered"
                    ? "border-primary-400 bg-primary-50"
                    : "border-background-300 bg-background-50 hover:bg-background-100"
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground-900">
                  Current filters
                  <i className="ri-filter-3-line text-primary-700" />
                </span>
                <span className="mt-1 block text-xs text-foreground-500">
                  {filteredAvailable
                    ? "All learners assigned to this live session"
                    : "Choose a live session first"}
                </span>
              </button>
            </div>
          </fieldset>

          {liveSessionReady && (
            <p className="text-xs text-foreground-500">
              The selected date must match the scheduled occurrence shown above.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-background-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="cursor-pointer rounded-lg border border-background-300 bg-background-50 px-4 py-2.5 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ date, lectureId, status, scope })}
            disabled={!canSave || saving}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className={saving ? "ri-loader-4-line animate-spin" : "ri-calendar-check-line"} />
            {saving ? "Adding attendance…" : "Add attendance"}
          </button>
        </div>
      </section>
    </div>
  );
}
