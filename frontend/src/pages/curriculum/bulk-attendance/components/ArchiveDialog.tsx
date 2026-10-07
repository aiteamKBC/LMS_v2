import { useEffect, useMemo, useState } from "react";
import type { AttendanceRow } from "./AttendanceTable";
import { avatarClass, formatShortDate, getInitials } from "@/utils/bulkAttendance";

interface ArchiveDialogProps {
  open: boolean;
  rows: AttendanceRow[];
  onClose: () => void;
  onConfirm: (learnerIds: string[]) => void;
}

export default function ArchiveDialog({
  open,
  rows,
  onClose,
  onConfirm,
}: ArchiveDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(rows.map((row) => row.learner.id));
      setSearch("");
    }
  }, [open, rows]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      ({ learner }) =>
        learner.name.toLowerCase().includes(term) ||
        learner.email.toLowerCase().includes(term)
    );
  }, [rows, search]);

  if (!open) return null;

  const allSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) => selected.includes(row.learner.id));

  const toggleOne = (learnerId: string) => {
    setSelected((prev) =>
      prev.includes(learnerId)
        ? prev.filter((id) => id !== learnerId)
        : [...prev, learnerId]
    );
  };

  const toggleAll = () => {
    const visibleIds = visibleRows.map((row) => row.learner.id);
    setSelected((prev) =>
      allSelected
        ? prev.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...prev, ...visibleIds]))
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-foreground-950/40" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-background-300 bg-background-50">
        <div className="flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-100 text-warning-700">
              <i className="ri-archive-line text-xl" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground-950">
                Archive learners
              </h3>
              <p className="mt-0.5 text-xs text-foreground-500">
                Pick anyone to move into your archive early. Learners who pass
                their end date are archived automatically, so this is for the
                exceptions.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-background-200 hover:text-foreground-900"
            aria-label="Close"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-b border-background-200 bg-background-100 px-5 py-2.5">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-background-300 bg-background-50 px-3 focus-within:border-primary-400">
            <i className="ri-search-line text-base text-foreground-500" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search learners by name or email"
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground-950 outline-none placeholder:text-foreground-400"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-foreground-500 hover:text-foreground-800"
                aria-label="Clear search"
              >
                <i className="ri-close-line" />
              </button>
            ) : (
              <span className="shrink-0 font-label text-xs text-foreground-400">
                {visibleRows.length} available
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground-700">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer accent-primary-500"
              />
              Select all ({visibleRows.length})
            </label>
            <span className="text-xs text-foreground-500">
              {selected.length} selected
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background-200 text-foreground-500">
                <i className="ri-search-line text-xl" />
              </span>
              <p className="text-sm font-medium text-foreground-950">
                No learners match
              </p>
              <p className="mt-1 text-sm text-foreground-500">
                Try a different name or email address.
              </p>
            </div>
          ) : (
            visibleRows.map(({ learner, index, groupName, cohortName }) => {
              const checked = selected.includes(learner.id);
              return (
                <label
                  key={learner.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-background-200 px-5 py-3 transition-colors last:border-b-0 hover:bg-background-100"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(learner.id)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-primary-500"
                  />
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClass(
                      index
                    )}`}
                  >
                    {getInitials(learner.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground-950">
                      {learner.name}
                    </span>
                    <span className="block truncate text-xs text-foreground-500">
                      {groupName}
                      <span className="mx-1 text-foreground-300">â€¢</span>
                      {cohortName}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-background-200 px-2.5 py-1 font-label text-xs text-foreground-700">
                    Ends {formatShortDate(learner.endDate)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-background-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            disabled={selected.length === 0}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="ri-archive-line" />
            Archive {selected.length > 0 ? selected.length : ""}{" "}
            {selected.length === 1 ? "learner" : "learners"}
          </button>
        </div>
      </div>
    </div>
  );
}

