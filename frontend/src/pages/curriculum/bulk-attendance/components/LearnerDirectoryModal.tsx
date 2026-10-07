import { useEffect, useMemo, useState } from "react";
import type { Learner } from "@/types/bulkAttendance";
import { getInitials } from "@/utils/bulkAttendance";

interface LearnerDirectoryModalProps {
  learners: Learner[];
  loading: boolean;
  onClose: () => void;
}

export default function LearnerDirectoryModal({
  learners,
  loading,
  onClose,
}: LearnerDirectoryModalProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const visibleLearners = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return learners;
    return learners.filter((learner) =>
      learner.name.toLocaleLowerCase().includes(term),
    );
  }, [learners, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/40 p-4"
      onClick={onClose}
    >
      <section
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-background-50 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learner-directory-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-background-200 p-5">
          <div>
            <h3 id="learner-directory-title" className="text-lg font-semibold text-foreground-950">
              Learner directory
            </h3>
            <p className="mt-1 text-sm text-foreground-500">
              {loading ? "Loading learner names…" : `${learners.length} learners from the KBC directory`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close learner directory"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-background-200 hover:text-foreground-900"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </header>

        <div className="border-b border-background-200 p-4">
          <label className="flex h-11 items-center gap-2 rounded-md border border-background-300 bg-background-50 px-3 focus-within:border-primary-400">
            <i className="ri-search-line text-base text-foreground-500" />
            <span className="sr-only">Search learner names</span>
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by full name"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground-950 outline-none placeholder:text-foreground-400"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-foreground-500">Loading learner names…</p>
          ) : visibleLearners.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-500">No learner names match that search.</p>
          ) : (
            <ul className="space-y-1.5" aria-label="Learner names">
              {visibleLearners.map((learner) => (
                <li
                  key={learner.id}
                  className="flex items-center gap-3 rounded-md border border-background-200 bg-background-100 px-3 py-2.5"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary-100 text-xs font-semibold text-secondary-900">
                    {getInitials(learner.name)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground-900">
                    {learner.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!loading && query && (
          <footer className="border-t border-background-200 px-5 py-3 text-xs text-foreground-500">
            {visibleLearners.length} matching {visibleLearners.length === 1 ? "learner" : "learners"}
          </footer>
        )}
      </section>
    </div>
  );
}
