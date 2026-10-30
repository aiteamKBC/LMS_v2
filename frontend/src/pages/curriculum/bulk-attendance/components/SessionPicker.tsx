import { AppIcon } from '@/components/feature/AppIcon';
import { formatDateLabel } from '@/utils/bulkAttendance';
import styles from '../bulkAttendance.module.css';

interface SessionPickerProps {
  sessions: Array<{ id: string; name: string; moduleName: string; sessionDate: string }>;
  selectedId?: string;
  date: string;
  loading: boolean;
  eligibleCount: number | null;
  markedCount: number | null;
  onChange: (date: string, id?: string) => void;
}

export default function SessionPicker({ sessions, selectedId, date, loading, eligibleCount, markedCount, onChange }: SessionPickerProps) {
  return <section className={styles.picker} aria-label="Pick a session">
    <div className={styles.stepHeading}><span className={styles.stepIcon}><AppIcon className="ri-calendar-line" /></span>
      <div><p>Step 1 · Pick a session</p><h2>{date ? formatDateLabel(date) : 'All dates'}{eligibleCount !== null ? ` · ${eligibleCount} learners in scope` : ''}</h2></div>
      <label className={styles.dateJump}><AppIcon className="ri-calendar-line" /><span>Jump to date</span><input type="date" aria-label="Jump to date" value={date} onChange={event => onChange(event.target.value)} /></label>
    </div>
    <div className={styles.dateStrip} aria-label="Scheduled sessions">
      {loading ? <p role="status">Loading sessions…</p> : sessions.length === 0 ? <p>No scheduled sessions in the current filters. You can still choose a date and review saved history.</p>
        : sessions.slice().sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || a.id.localeCompare(b.id)).map(session => <button key={session.id} type="button" aria-pressed={selectedId === session.id} aria-label={`Open register for ${session.name} - ${session.moduleName} - ${formatDateLabel(session.sessionDate)}`}
          onClick={() => onChange(session.sessionDate, session.id)} className={styles.dateTile}>
          <span>{formatDateLabel(session.sessionDate)}</span><strong>{session.name}</strong><small>{session.moduleName}</small>
          {selectedId === session.id && eligibleCount !== null && markedCount !== null ? <span className={styles.tileCount}>{markedCount}/{eligibleCount} marked</span> : <small>Open register</small>}
        </button>)}
    </div>
  </section>;
}
