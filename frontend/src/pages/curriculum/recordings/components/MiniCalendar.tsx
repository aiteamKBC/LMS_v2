import {
  WEEKDAY_SHORT,
  formatMonthLabel,
  getMonthMatrix,
  parseIsoDate,
  todayIso,
} from "@/pages/curriculum/recordings/utils";
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import styles from '@/components/feature/RecordingsMiniCalendar.module.css';

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
    <div className={styles.root}>
      <div className={styles.card}>
      <div className={styles.header}>
        <p className={styles.heading}>
          {formatMonthLabel(viewYear, viewMonth)}
        </p>
        <div className={styles.monthNavigation}>
          <button
            type="button"
            onClick={() => onMonthChange(-1)}
            aria-label="Previous month"
            className={styles.navigation}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(1)}
            aria-label="Next month"
            className={styles.navigation}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.weekdays}>
        {WEEKDAY_SHORT.map((day) => (
          <span
            key={day}
            className={styles.weekday}
          >
            {day.slice(0, 2)}
          </span>
        ))}
      </div>

      <div className={styles.days}>
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
              className={`${styles.day} ${inMonth ? '' : styles.outside}`}
            >
              {parseIsoDate(iso).day}
              {isToday && !isSelected ? (
                <span aria-hidden="true" className={styles.todayMark}></span>
              ) : null}
              {hasLecture ? (
                <span
                  aria-hidden="true"
                  className={styles.dot}
                ></span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!compact && <div className={styles.dayNavigation}>
        <button
          type="button"
          onClick={onPrevDay}
          aria-label="Previous day"
          className={styles.navigation}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className={styles.today}
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNextDay}
          aria-label="Next day"
          className={styles.navigation}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>}
      </div>
      <div className={`${styles.card} ${styles.legend}`}>
        <p className={styles.note}>A purple dot marks a day with a lecture.</p>
        <p className={styles.legendTitle}>
          Recording status
        </p>
        <ul className={styles.statusList}>
          <li className={styles.status}>
            <span aria-hidden="true" className={`${styles.statusDot} bg-accent-500`}></span> Ready to download
          </li>
          <li className={styles.status}>
            <span aria-hidden="true" className={`${styles.statusDot} bg-amber-500`}></span> Processing
          </li>
          <li className={styles.status}>
            <span aria-hidden="true" className={`${styles.statusDot} bg-rose-500`}></span> Not recorded
          </li>
          <li className={styles.status}>
            <span aria-hidden="true" className={`${styles.statusDot} bg-rose-700`}></span> Archive failed
          </li>
          <li className={styles.status}>
            <span aria-hidden="true" className={`${styles.statusDot} bg-secondary-500`}></span> Awaiting sync
          </li>
        </ul>
        <p className={styles.timeZone}>
          <Clock3 size={13} aria-hidden="true" /><span>All times shown in {timeZone}</span>
        </p>
      </div>
    </div>
  );
}
