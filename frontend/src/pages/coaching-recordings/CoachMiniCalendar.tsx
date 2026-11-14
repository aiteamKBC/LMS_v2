import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { addDays, formatMonthLabel, getMonthMatrix, parseIsoDate, todayIso, WEEKDAY_SHORT } from '@/pages/curriculum/recordings/utils';
import styles from '@/components/feature/RecordingsMiniCalendar.module.css';

interface Props {
  date: string;
  timeZone: string;
  meetingDates: Set<string>;
  onSelectDay: (date: string) => void;
}

export default function CoachMiniCalendar({ date, timeZone, meetingDates, onSelectDay }: Props) {
  const { year, month } = parseIsoDate(date);
  const changeMonth = (delta: number) => onSelectDay(new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10));
  return <aside aria-label="Choose meeting date" className={`${styles.root} ${styles.card} self-start`}>
    <div className={styles.header}>
      <h2 className={styles.heading}>{formatMonthLabel(year, month)}</h2>
      <div className={styles.monthNavigation}><button type="button" className={styles.navigation} aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button>
        <button type="button" className={styles.navigation} aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button></div>
    </div>
    <div className={styles.weekdays}>
      {WEEKDAY_SHORT.map(day => <span key={day} className={styles.weekday}>{day.slice(0, 2)}</span>)}
    </div>
    <div className={styles.days}>
      {getMonthMatrix(year, month).map(day => <button type="button" key={day} aria-label={`Show meetings on ${day}`}
        aria-current={day === date ? 'date' : undefined} onClick={() => onSelectDay(day)}
        className={`${styles.day} ${parseIsoDate(day).month !== month ? styles.outside : ''}`}>
        {parseIsoDate(day).day}
        {meetingDates.has(day) && <span aria-hidden="true" className={styles.dot} />}
        {day === todayIso(timeZone) && day !== date && <span aria-hidden="true" className={styles.todayMark} />}
      </button>)}
    </div>
    <div className={styles.dayNavigation}>
      <button type="button" className={styles.navigation} aria-label="Previous day" onClick={() => onSelectDay(addDays(date, -1))}><ChevronLeft size={16} /></button>
      <button type="button" aria-label="Today in mini calendar" onClick={() => onSelectDay(todayIso(timeZone))} className={styles.today}>Today</button>
      <button type="button" className={styles.navigation} aria-label="Next day" onClick={() => onSelectDay(addDays(date, 1))}><ChevronRight size={16} /></button>
    </div>
    <p className={styles.note}>Dots mark meetings in the loaded period only. A date without a dot may not have been checked. Choose a date or Month view to check it.</p>
    <div className={styles.legend}>
      <p className={styles.legendTitle}>Meeting status</p>
      <ul className={styles.statusList}>
      {[['bg-emerald-500', 'Recording available'], ['bg-primary-400', 'Upcoming / within scheduled time'], ['bg-amber-400', 'Recording pending'], ['bg-rose-400', 'Cancelled']].map(([color, label]) =>
        <li key={label} className={styles.status}><span aria-hidden="true" className={`${styles.statusDot} ${color}`} />{label}</li>)}
      </ul>
      <p className={styles.timeZone}><Clock3 size={13} aria-hidden="true" /><span>All times shown in {timeZone}</span></p>
    </div>
  </aside>;
}
