import type { Lecture } from '../types';
import { STATUS_META, formatFullDate, formatTimeRange, lectureOverallStatus, lectureStatusSummary } from '../utils';

interface DayGridProps {
  date: string;
  lectures: Lecture[];
  selectedLectureId: string | null;
  emptyReason: 'none' | 'filtered';
  onSelectLecture: (lecture: Lecture) => void;
  onFindNextLectureDay: () => void;
  onClearFilters: () => void;
}

/** A time ordered agenda keeps titles readable even when many meetings overlap. */
export default function DayGrid({ date, lectures, selectedLectureId, emptyReason, onSelectLecture,
  onFindNextLectureDay, onClearFilters }: DayGridProps) {
  if (!lectures.length) {
    const filtered = emptyReason === 'filtered';
    return <div className="flex min-h-72 items-center justify-center rounded-xl border border-background-200 bg-background-50 p-6 text-center">
      <div className="max-w-sm">
        <i className={`${filtered ? 'ri-filter-off-line' : 'ri-calendar-line'} text-2xl text-primary-600`} aria-hidden="true" />
        <h3 className="mt-2 font-heading text-lg font-bold text-foreground-950">{filtered ? 'No lectures match your filters' : 'No lectures scheduled'}</h3>
        <p className="mt-2 text-sm text-foreground-600">{filtered
          ? 'There are sessions on this day, but none match the current search or filters.'
          : `Nothing is timetabled for ${formatFullDate(date)}.`}</p>
        <button type="button" onClick={filtered ? onClearFilters : onFindNextLectureDay}
          className="mt-4 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
          {filtered ? 'Clear search and filters' : 'Find next lecture day'}
        </button>
      </div>
    </div>;
  }

  const slots = new Map<string, Lecture[]>();
  for (const lecture of [...lectures].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title))) {
    const slot = slots.get(lecture.startTime) ?? [];
    slot.push(lecture);
    slots.set(lecture.startTime, slot);
  }

  return <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-background-200 bg-background-50 p-3 scrollbar-slim sm:p-4">
    <div className="space-y-5">
      {[...slots].map(([time, events]) => <section key={time} className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4"
        aria-label={`${time} lectures`}>
        <div className="border-r border-background-200 pr-2 pt-2 text-right text-xs font-bold tabular-nums text-primary-700 sm:pr-3 sm:text-sm">{time}</div>
        <div className="min-w-0 space-y-2">
          {events.map(lecture => {
            const status = lectureOverallStatus(lecture);
            const meta = STATUS_META[status];
            return <button key={lecture.id} type="button" aria-pressed={lecture.id === selectedLectureId}
              onClick={() => onSelectLecture(lecture)}
              className={`w-full min-w-0 rounded-lg border border-background-200 border-l-4 bg-background-50 p-3 text-left transition-colors hover:bg-primary-50 ${meta.borderLeft} ${lecture.id === selectedLectureId ? 'ring-2 ring-primary-300' : ''}`}>
              <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 break-words font-heading text-sm font-bold leading-snug text-foreground-950">{lecture.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-foreground-600">{formatTimeRange(lecture.startTime, lecture.endTime)}</span>
              </span>
              <span className="mt-1 block break-words text-xs text-foreground-600">{lecture.module} · {lecture.group}</span>
              <span className={`mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium ${meta.textClass}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass}`} />{lectureStatusSummary(lecture)}
              </span>
            </button>;
          })}
        </div>
      </section>)}
    </div>
  </div>;
}
