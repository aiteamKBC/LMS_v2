import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../bulkAttendance.module.css';

export default function RegisterSummary({ title, ready, present, absent, unmarked }: { title: string; ready: boolean; present: number; absent: number; unmarked: number }) {
  const total = present + absent + unmarked;
  const completion = ready && total > 0 ? Math.round((present + absent) / total * 100) : null;
  return <header className={styles.registerHeading}>
    <span className={`${styles.stepIcon} ${styles.purpleIcon}`}><AppIcon className="ri-user-follow-line" /></span>
    <div><p>Step 2 · Mark the register</p><h2>{title}</h2></div>
    <div className={styles.registerCounts} aria-label="Current register summary">
      <span className={styles.present}>Present <strong>{ready ? present : '—'}</strong></span>
      <span className={styles.absent}>Absent <strong>{ready ? absent : '—'}</strong></span>
      <span>Unmarked <strong>{ready ? unmarked : '—'}</strong></span>
      <span className={styles.completion}><progress aria-label="Register completion" max={100} value={completion ?? 0} /><span>{completion === null ? 'Completion unavailable' : `${completion}% marked`}</span></span>
    </div>
  </header>;
}
