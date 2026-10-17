import type { Lecture } from "@/pages/curriculum/recordings/types";
import {
  STATUS_META,
  formatFullDate,
  lectureOverallStatus,
  lectureStatusSummary,
} from "@/pages/curriculum/recordings/utils";

interface AgendaListProps {
  date: string;
  lectures: Lecture[];
  selectedLectureId: string | null;
  emptyReason: "none" | "filtered";
  onSelectLecture: (lecture: Lecture) => void;
  onClearFilters: () => void;
}

export default function AgendaList({
  date,
  lectures,
  selectedLectureId,
  emptyReason,
  onSelectLecture,
  onClearFilters,
}: AgendaListProps) {
  if (lectures.length === 0) {
    const filtered = emptyReason === "filtered";
    return (
      <div className="rounded-lg border border-background-200 bg-background-50 p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
          <i className={filtered ? "ri-filter-off-line text-xl" : "ri-calendar-line text-xl"} aria-hidden="true"></i>
        </span>
        <h3 className="mt-3 font-heading text-base font-bold text-foreground-950">
          {filtered ? "No lectures match your filters" : "No lectures scheduled"}
        </h3>
        <p className="mt-1.5 text-sm text-foreground-600">
          {filtered
            ? "Try clearing the search or filters to see the full day."
            : `Nothing is timetabled for ${formatFullDate(date)}.`}
        </p>
        {filtered ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-4 inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-primary-300 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-800 transition-colors hover:bg-primary-100"
          >
            <i className="ri-eraser-line" aria-hidden="true"></i>
            Clear search and filters
          </button>
        ) : null}
      </div>
    );
  }

  const sorted = [...lectures].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="space-y-2.5">
      {sorted.map((lecture) => {
        const status = lectureOverallStatus(lecture);
        const meta = STATUS_META[status];
        const isSelected = lecture.id === selectedLectureId;

        return (
          <button
            key={lecture.id}
            type="button"
            onClick={() => onSelectLecture(lecture)}
            aria-pressed={isSelected}
            className={`flex w-full items-stretch gap-3 rounded-lg border bg-background-50 p-3 text-left transition-colors ${
              isSelected ? "border-primary-400 ring-2 ring-primary-200" : "border-background-200 hover:bg-background-100"
            }`}
          >
            <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-md bg-primary-50 py-2 text-center">
              <span className="font-heading text-sm font-bold text-primary-800">{lecture.startTime}</span>
              <span className="text-[11px] text-foreground-500">{lecture.endTime}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-heading text-sm font-bold leading-snug text-foreground-950">
                {lecture.title}
              </span>
              <span className="mt-1 block truncate text-xs text-foreground-600">
                {lecture.module} · {lecture.group}
              </span>
              <span className={`mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium ${meta.textClass}`}>
                <span className={`h-2 w-2 rounded-full ${meta.dotClass}`}></span>
                {lectureStatusSummary(lecture)}
              </span>
            </span>
            <span className="flex items-center pr-0.5 text-foreground-400">
              <i className="ri-arrow-right-s-line text-xl" aria-hidden="true"></i>
            </span>
          </button>
        );
      })}
    </div>
  );
}