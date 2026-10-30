import { WEEKDAY_SHORT, formatMonthLabel, getMonthMatrix, parseIsoDate, todayIso, STATUS_META } from '../utils';
import type { RecordingStatus } from '../types';
import styles from '../RecordingsPage.module.css';

interface MiniCalendarProps {
  compact?: boolean;
  selectedDate: string; viewYear: number; viewMonth: number; lectureDates: Set<string>; timeZone: string;
  onSelectDate: (iso: string) => void; onMonthChange: (delta: number) => void;
  onToday: () => void; onPrevDay: () => void; onNextDay: () => void;
  dateStatuses?: Map<string, Set<RecordingStatus>>;
  latestRecordedDate?: string; onLatest?: () => void;
}

export default function MiniCalendar({ selectedDate, viewYear, viewMonth, lectureDates, timeZone, onSelectDate, onMonthChange, dateStatuses, latestRecordedDate, onLatest }: MiniCalendarProps) {
  const core: RecordingStatus[] = ['ready', 'pending', 'unsynced', 'missing', 'archiveFailed', 'review'];
  const observed = new Set([...(dateStatuses?.values() || [])].flatMap(statuses => [...statuses]));
  const legend = [...core, ...[...observed].filter(status => !core.includes(status))];
  return <div>
    <div className={styles.calendar}>
      <div className={styles.calendarHeader}><p>{formatMonthLabel(viewYear, viewMonth)}</p><div>
        <button type="button" aria-label="Previous month" onClick={() => onMonthChange(-1)}><span aria-hidden="true">‹</span></button>
        <button type="button" aria-label="Next month" onClick={() => onMonthChange(1)}><span aria-hidden="true">›</span></button>
      </div></div>
      <div className={styles.calendarGrid}>
        {WEEKDAY_SHORT.map(day => <span key={day}>{day.slice(0,1)}</span>)}
        {getMonthMatrix(viewYear, viewMonth).map(iso => {
          const statuses = [...(dateStatuses?.get(iso) || [])];
          return <button key={iso} type="button" className={styles.dateCell} data-current={parseIsoDate(iso).month === viewMonth}
            aria-current={selectedDate === iso ? 'date' : undefined} aria-label={`Select ${iso}`}
            title={`${iso}${iso === todayIso(timeZone) ? ' · Today' : ''}${statuses.length ? ` · ${statuses.map(status => STATUS_META[status].label).join(', ')}` : ''}`}
            onClick={() => onSelectDate(iso)}>
            {parseIsoDate(iso).day}
            <span className={styles.dateDots} aria-hidden="true">{statuses.length ? statuses.slice(0,3).map(status => <i key={status} className={styles.statusColor} data-status={status} />) : lectureDates.has(iso) ? <i /> : null}</span>
          </button>;
        })}
      </div>
      <button type="button" onClick={onLatest} disabled={!latestRecordedDate || !onLatest} className={styles.latest}>Latest recorded day</button>
    </div>
    <section className={styles.legend} aria-label="Recording status legend"><h3>Recording status</h3><ul>{legend.map(status => <li key={status}><i className={styles.statusColor} data-status={status} />{status === 'ready' ? 'Ready to download' : STATUS_META[status].label}</li>)}</ul><p>Dots mark matching lectures. Up to three colours show their recording states. Times use {timeZone}.</p></section>
  </div>;
}
