import type { AttendanceMode } from '@/api/attendanceLectures';
import { Panel } from '@/components/ui/Panel';
import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../attendance.module.css';

export default function AttendanceModePanel({ mode }: {
  mode: AttendanceMode; busy: boolean; error: string; notice: string; onChange: (value: 'live' | 'lazy') => void;
}) {
  return <Panel className={styles.modePanel}>
    <div className={styles.sidebarHeading}>
      <span className={styles.sectionIcon}><AppIcon className="ri-slideshow-line" /></span>
      <div className={styles.modeIdentity}><h2>Attendance Mode</h2>
        <p className="mt-2 text-sm font-semibold">Live Sessions</p>
      </div>
    </div>
    <details className={styles.modeDetails}><summary>Planned hours &amp; reminders</summary>
      <p className="mt-2 text-xs">Remaining planned hours: <strong>{mode.plannedLiveHours ?? 0} live</strong> ? <strong>{mode.plannedRecordedHours ?? 0} recorded</strong></p>
      {!!mode.unmappedPlannedLectures && <p className="mt-1 text-xs text-foreground-500">Duration is not recorded for {mode.unmappedPlannedLectures} upcoming lecture(s).</p>}
      <p className="mt-1 text-xs text-foreground-500">Absence reminders: enabled</p>
    </details>
  </Panel>;
}
