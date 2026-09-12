import type { AttendanceMode } from '@/api/attendanceLectures';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function AttendanceModePanel({ mode, busy, error, notice, onChange }: {
  mode: AttendanceMode; busy: boolean; error: string; notice: string; onChange: (value: 'live' | 'lazy') => void;
}) {
  const pending = mode.requestedMode === 'lazy';
  return <Panel><SectionHeader title="Attendance Mode" icon="ri-slideshow-line" />
    <div className="mt-3 flex gap-2" role="group" aria-label="Attendance mode">
      {(['live', 'lazy'] as const).map(value => <button key={value} disabled={busy || !mode.available || (value === 'lazy' && !mode.managerAvailable)}
        aria-pressed={value === (mode.requestedMode || mode.mode)} onClick={() => onChange(value)}
        className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold disabled:opacity-50 ${value === (mode.requestedMode || mode.mode) ? 'border-primary-600 bg-primary-600 text-white' : 'border-foreground-200 bg-background-50 text-foreground-700'}`}>
        {value === 'live' ? 'Live Sessions' : 'Lazy Mode'}</button>)}
    </div>
    <p className="mt-3 text-xs leading-5 text-foreground-500">Lazy Mode pauses absence reminder emails and requests your manager's approval. Once approved, your remaining planned lecture hours move to recorded sessions.</p>
    {!mode.available ? <p className="mt-2 text-xs text-foreground-500">Attendance mode is not available yet. Contact support for help.</p> : <>
      {pending && <p className="mt-2 text-xs font-semibold">Awaiting manager approval. Reminders are paused.{!mode.emailSent && ' Email not sent — select Lazy Mode to retry.'}</p>}
      {!mode.managerAvailable && <p className="mt-2 text-xs text-foreground-500">Ask support to link your manager before requesting Lazy Mode.</p>}
      {mode.status === 'declined' && <p className="mt-2 text-xs">Your manager declined the request. Live Sessions remains active.</p>}
      {mode.status === 'expired' && <p className="mt-2 text-xs">Your approval request expired. Select Lazy Mode to request approval again.</p>}
      <p className="mt-3 text-xs">Remaining planned hours: <strong>{mode.plannedLiveHours ?? 0} live</strong> · <strong>{mode.plannedRecordedHours ?? 0} recorded</strong></p>
      {!!mode.unmappedPlannedLectures && <p className="mt-1 text-xs text-foreground-500">Duration is not recorded for {mode.unmappedPlannedLectures} upcoming lecture(s).</p>}
      <p className="mt-1 text-xs text-foreground-500">Absence reminders: {mode.remindersEnabled ? 'enabled' : 'paused'}</p>
    </>}
    {busy && <p role="status" className="mt-2 text-xs">Saving attendance mode...</p>}
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </Panel>;
}
