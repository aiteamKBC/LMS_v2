import styles from '../RecordingsPage.module.css';
import { AppIcon } from '@/components/feature/AppIcon';
import { useState, type KeyboardEvent } from "react";
import type { Lecture, RecordingFilter } from "@/pages/curriculum/recordings/types";
import { formatCompactDate, lectureStatusSummary } from "@/pages/curriculum/recordings/utils";

interface SearchAndFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  programmes: string[];
  programme: string;
  onProgrammeChange: (value: string) => void;
  statusFilter: RecordingFilter;
  onStatusFilterChange: (value: RecordingFilter) => void;
  results: Lecture[];
  searchScope?: string;
  onSelectResult: (lecture: Lecture) => void;
  onReset: () => void;
}

export default function SearchAndFilters({
  query,
  onQueryChange,
  programmes,
  programme,
  onProgrammeChange,
  statusFilter,
  onStatusFilterChange,
  results,
  searchScope,
  onSelectResult,
  onReset,
}: SearchAndFiltersProps) {
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const showResults = focused && query.trim().length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const lecture = results[activeIndex];
      if (lecture) onSelectResult(lecture);
    } else if (event.key === "Escape") {
      setFocused(false);
    }
  };

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div
          className={`relative flex-1 ${styles.searchField}`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <span className={styles.filterLabel}>Search lectures</span>
          <span className="pointer-events-none absolute left-3 top-[calc(50%+9px)] flex h-5 w-5 -translate-y-1/2 items-center justify-center text-foreground-400">
            <AppIcon name="ri-search-line" size={15} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Lecture title, module, programme, cohort or group"
            aria-label="Search lectures by title"
            className="w-full rounded-md border border-background-200 bg-background-50 py-2.5 pl-10 pr-9 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-[calc(50%+9px)] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-background-100 hover:text-foreground-800"
            >
              <i className="ri-close-line" aria-hidden="true"></i>
            </button>
          ) : null}

          {showResults ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-lg border border-background-200 bg-background-50 p-1.5 animate-pop-in scrollbar-slim">
              <p className="px-3 py-2 text-xs font-semibold text-foreground-600">{results.length} matching lectures{searchScope ? ` - ${searchScope}` : ''}</p>
              {results.length === 0 ? (
                <p className="px-3 py-4 text-sm text-foreground-500">
                  No lectures match “{query}”.
                </p>
              ) : (
                results.map((lecture, index) => (
                  <button
                    key={lecture.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelectResult(lecture)}
                    className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                      index === activeIndex ? "bg-primary-50" : "hover:bg-background-100"
                    }`}
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700">
                      <i className="ri-play-circle-line text-lg" aria-hidden="true"></i>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground-950">
                        {lecture.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-foreground-600">
                        {formatCompactDate(lecture.date)} · {lecture.startTime} · {lecture.programme}
                      </span>
                      <span className="mt-1 block text-xs text-foreground-500">
                        {lecture.module} / {lecture.group}{lecture.week ? ` / Week ${lecture.week}` : ''} / {lectureStatusSummary(lecture)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div className={styles.filterDropdowns}>
          <div><span className={styles.filterLabel}>Programme</span>
          <label className="relative inline-flex items-center">
            <span className="sr-only">Filter by programme</span>
            <i
              className="ri-graduation-cap-line pointer-events-none absolute left-3 text-base text-foreground-500"
              aria-hidden="true"
            ></i>
            <select
              value={programme}
              onChange={(event) => onProgrammeChange(event.target.value)}
              className="w-full appearance-none rounded-md border border-background-200 bg-background-50 py-2.5 pl-9 pr-8 text-sm text-foreground-800 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            >
              <option value="all">All programmes</option>
              {programmes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <i
              className="ri-arrow-down-s-line pointer-events-none absolute right-2.5 text-base text-foreground-500"
              aria-hidden="true"
            ></i>
          </label></div>

          <div><span className={styles.filterLabel}>Recording status</span><label className="relative inline-flex items-center">
            <span className="sr-only">Filter by recording status</span>
            <i
              className="ri-filter-3-line pointer-events-none absolute left-3 text-base text-foreground-500"
              aria-hidden="true"
            ></i>
            <select
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as RecordingFilter)}
              className="w-full appearance-none rounded-md border border-background-200 bg-background-50 py-2.5 pl-9 pr-8 text-sm text-foreground-800 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            >
              <option value="all">All recordings</option>
              <option value="ready">Ready to download</option>
              <option value="attention">Needs attention</option>
              <option value="pending">Processing</option><option value="missing">Not recorded</option><option value="unsynced">Awaiting sync</option><option value="archiveFailed">Archive failed</option><option value="review">Review placement</option>
            </select>
            <i
              className="ri-arrow-down-s-line pointer-events-none absolute right-2.5 text-base text-foreground-500"
              aria-hidden="true"
            ></i>
          </label></div>
          <button type="button" onClick={onReset} className={styles.reset}>Reset</button>
        </div>
      </div>

      {programme !== "all" || statusFilter !== "all" ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-foreground-600">
          <span>Active filters:</span>
          {programme !== "all" ? <StatusChip label={programme} /> : null}
          {statusFilter !== "all" ? (
            <StatusChip label={statusFilter === "ready" ? "Ready to download" : statusFilter === "attention" ? "Needs attention" : statusFilter === "pending" ? "Processing" : statusFilter === "missing" ? "Not recorded" : statusFilter === "unsynced" ? "Awaiting sync" : statusFilter === "review" ? "Review placement" : "Archive failed"} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary-100 px-2.5 py-0.5 font-medium text-secondary-900">
      {label}
    </span>
  );
}
