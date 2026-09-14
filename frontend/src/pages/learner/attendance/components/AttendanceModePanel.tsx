import type { AttendanceMode } from '@/api/attendanceLectures';
import { Info } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../attendance.module.css';

export default function AttendanceModePanel({ mode, busy, error, notice, onChange }: {
  mode: AttendanceMode; busy: boolean; error: string; notice: string; onChange: (value: 'live' | 'lazy') => void;
}) {
  const pending = mode.requestedMode === 'lazy';
  const lazy = (mode.requestedMode || mode.mode) === 'lazy';
  return <Panel className={styles.modePanel}>
    <div className={styles.sidebarHeading}>
      <span className={styles.sectionIcon}><AppIcon className="ri-slideshow-line" /></span>
      <div className={styles.modeIdentity}><h2>Attendance Mode</h2>
        <div className={styles.modeControls} role="group" aria-label="Attendance mode">
          <button type="button" disabled={busy || !mode.available} aria-pressed={!lazy} onClick={() => onChange('live')}>Live Sessions</button>
          <button type="button" role="switch" aria-label="Lazy Mode" aria-checked={lazy} className={styles.modeSwitch}
            disabled={busy || !mode.available || (!lazy && !mode.managerAvailable)} onClick={() => onChange(lazy ? 'live' : 'lazy')}><span /></button>
          <button type="button" disabled={busy || !mode.available || !mode.managerAvailable} aria-pressed={lazy} onClick={() => onChange('lazy')}>Lazy Mode</button>
        </div>
      </div>
    </div>
    <div className={styles.modeGuidance}><Info aria-hidden="true" /><div><strong>Stay on track, go further.</strong><p>Switch to Lazy Mode to move remaining planned hours to recorded sessions, once your manager approves.</p></div></div>
    {!mode.available ? <p className="mt-2 text-xs text-foreground-500">Attendance mode is not available yet. Contact support for help.</p> : <>
      {pending && <p className="mt-2 text-xs font-semibold">Awaiting manager approval. Reminders are paused.{!mode.emailSent && ' Email not sent — select Lazy Mode to retry.'}</p>}
      {!mode.managerAvailable && <p className="mt-2 text-xs text-foreground-500">Ask support to link your manager before requesting Lazy Mode.</p>}
      {mode.status === 'declined' && <p className="mt-2 text-xs">Your manager declined the request. Live Sessions remains active.</p>}
      {mode.status === 'expired' && <p className="mt-2 text-xs">Your approval request expired. Select Lazy Mode to request approval again.</p>}
      <details className={styles.modeDetails}><summary>Planned hours &amp; reminders</summary>
      <p className="mt-2 text-xs">Remaining planned hours: <strong>{mode.plannedLiveHours ?? 0} live</strong> · <strong>{mode.plannedRecordedHours ?? 0} recorded</strong></p>
      {!!mode.unmappedPlannedLectures && <p className="mt-1 text-xs text-foreground-500">Duration is not recorded for {mode.unmappedPlannedLectures} upcoming lecture(s).</p>}
      <p className="mt-1 text-xs text-foreground-500">Absence reminders: {mode.remindersEnabled ? 'enabled' : 'paused'}</p>
      <p className="mt-1 text-xs text-foreground-500">Requesting Lazy Mode pauses absence reminder emails while your manager reviews the request.</p>
      </details>
    </>}
    {busy && <p role="status" className="mt-2 text-xs">Saving attendance mode...</p>}
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </Panel>;
}
