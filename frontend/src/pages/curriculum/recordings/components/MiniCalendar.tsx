import {
  WEEKDAY_SHORT,
  formatMonthLabel,
  getMonthMatrix,
  parseIsoDate,
  todayIso,
} from "@/pages/curriculum/recordings/utils";

interface MiniCalendarProps {
  compact?: boolean;
  selectedDate: string;
  viewYear: number;
  viewMonth: number;
  lectureDates: Set<string>;
  timeZone: string;
  onSelectDate: (iso: string) => void;
  onMonthChange: (delta: number) => void;
  onToday: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
}

export default function MiniCalendar({
  compact = false,
  selectedDate,
  viewYear,
  viewMonth,
  lectureDates,
  timeZone,
  onSelectDate,
  onMonthChange,
  onToday,
  onPrevDay,
  onNextDay,
}: MiniCalendarProps) {
  const cells = getMonthMatrix(viewYear, viewMonth);

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-4">
      {!compact && <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevDay}
          aria-label="Previous day"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-background-200 text-foreground-700 transition-colors hover:bg-background-100 hover:text-primary-700"
        >
          <i className="ri-arrow-left-s-line text-lg" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          onClick={onToday}
          className="flex-1 whitespace-nowrap rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-700"
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNextDay}
          aria-label="Next day"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-background-200 text-foreground-700 transition-colors hover:bg-background-100 hover:text-primary-700"
        >
          <i className="ri-arrow-right-s-line text-lg" aria-hidden="true"></i>
        </button>
      </div>}

      <div className={`${compact ? '' : 'mt-5'} flex items-center justify-between`}>
        <p className="font-heading text-sm font-bold text-foreground-950">
          {formatMonthLabel(viewYear, viewMonth)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(-1)}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-600 transition-colors hover:bg-background-100 hover:text-primary-700"
          >
            <span aria-hidden="true">&lsaquo;</span>
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(1)}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-600 transition-colors hover:bg-background-100 hover:text-primary-700"
          >
            <span aria-hidden="true">&rsaquo;</span>
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAY_SHORT.map((day) => (
          <span
            key={day}
            className="flex h-7 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-foreground-400"
          >
            {day.slice(0, 1)}
          </span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso) => {
          const { month } = parseIsoDate(iso);
          const inMonth = month === viewMonth;
          const isSelected = iso === selectedDate;
          const isToday = iso === todayIso(timeZone);
          const hasLecture = lectureDates.has(iso);

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`Select ${iso}`}
              className={`relative flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors ${
                isSelected
                  ? "bg-primary-600 font-semibold text-background-50"
                  : inMonth
                    ? "text-foreground-800 hover:bg-primary-100 hover:text-primary-800"
                    : "text-foreground-300 hover:bg-background-100"
              }`}
            >
              {parseIsoDate(iso).day}
              {isToday && !isSelected ? (
                <span className="absolute inset-x-1.5 bottom-0.5 h-0.5 rounded-full bg-primary-500"></span>
              ) : null}
              {hasLecture ? (
                <span
                  className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                    isSelected ? "bg-background-50" : "bg-primary-500"
                  }`}
                ></span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2 border-t border-background-200 pt-4">
        <p className="text-[11px] text-foreground-500">A purple dot marks a day with a lecture.</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
          Recording status
        </p>
        <ul className="space-y-1.5 text-xs text-foreground-700">
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-accent-500"></span> Ready to download
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span> Processing
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span> Not recorded
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span> Archive failed
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-secondary-500"></span> Awaiting sync
          </li>
        </ul>
        <p className="flex items-center gap-1.5 pt-1 text-[11px] text-foreground-500">
          <i className="ri-time-line" aria-hidden="true"></i>
          All times shown in {timeZone}
        </p>
      </div>
    </div>
  );
}
