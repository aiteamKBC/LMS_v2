import type { AttendanceMode } from '@/api/attendanceLectures';
import { Info } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../attendance.module.css';

export default function AttendanceModePanel({ mode }: { mode: AttendanceMode }) {
  const pending = mode.requestedMode === 'lazy';
  const lazy = (mode.requestedMode || mode.mode) === 'lazy';
  return <Panel className={styles.modePanel}>
    <div className={styles.sidebarHeading}>
      <span className={styles.sectionIcon}><AppIcon className="ri-slideshow-line" /></span>
      <div className={styles.modeIdentity}><h2>Attendance Mode</h2>
        <div className={styles.modeControls} role="group" aria-label="Attendance mode">
          <button type="button" disabled aria-pressed={!lazy}>Live Sessions</button>
          <button type="button" role="switch" aria-label="Lazy Mode" aria-checked={lazy} className={styles.modeSwitch}
            disabled><span /></button>
          <button type="button" disabled aria-pressed={lazy}>Lazy Mode</button>
        </div>
      </div>
    </div>
    <div className={styles.modeGuidance}><Info aria-hidden="true" /><div><strong>Stay on track, go further.</strong><p>Your attendance mode is managed by your learning team. Contact support if it needs to change.</p></div></div>
    {!mode.available ? <p className="mt-2 text-xs text-foreground-500">Attendance mode is not available yet. Contact support for help.</p> : <>
      {pending && <p className="mt-2 text-xs font-semibold">Awaiting manager approval. Reminders are paused.{!mode.emailSent && ' Email not sent — contact support for help.'}</p>}
      {mode.status === 'declined' && <p className="mt-2 text-xs">Your manager declined the request. Live Sessions remains active.</p>}
      {mode.status === 'expired' && <p className="mt-2 text-xs">Your approval request expired. Contact support if your attendance mode needs to change.</p>}
      <details className={styles.modeDetails}><summary>Planned hours &amp; reminders</summary>
      <p className="mt-2 text-xs">Remaining planned hours: <strong>{mode.plannedLiveHours ?? 0} live</strong> · <strong>{mode.plannedRecordedHours ?? 0} recorded</strong></p>
      {!!mode.unmappedPlannedLectures && <p className="mt-1 text-xs text-foreground-500">Duration is not recorded for {mode.unmappedPlannedLectures} upcoming lecture(s).</p>}
      <p className="mt-1 text-xs text-foreground-500">Absence reminders: {mode.remindersEnabled ? 'enabled' : 'paused'}</p>
      <p className="mt-1 text-xs text-foreground-500">Absence reminder emails remain paused while a manager approval request is pending.</p>
      </details>
    </>}
  </Panel>;
}
