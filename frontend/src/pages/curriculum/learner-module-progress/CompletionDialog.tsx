import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatSystemTimestamp } from '@/lib/format';
import type { ProgressRow } from './progressView';
import { completionEnd, localTimeInput } from './completionTime';
import type { CurriculumActivityCompletionTime } from '@/lib/curriculumApi';

export default function CompletionDialog({ row, onClose, onSave, recording = false }: {
  row: ProgressRow; onClose: () => void;
  recording?: boolean;
  onSave: (values: CurriculumActivityCompletionTime) => Promise<void>;
}) {
  const state = 'logState' in row.activity ? row.activity.logState : undefined;
  const initial = Math.round((state?.actualOtjh || 0) * 3600);
  const [hours, setHours] = useState(String(Math.floor(initial / 3600)));
  const [minutes, setMinutes] = useState(String(Math.floor(initial % 3600 / 60)));
  const [seconds, setSeconds] = useState(String(initial % 60));
  const [start, setStart] = useState(localTimeInput(state?.startedAt));
  const [date, setDate] = useState(state?.activityDate || localTimeInput(state?.startedAt).slice(0, 10));
  const [mode, setMode] = useState<'input' | 'timestamp' | ''>(state?.progressId != null ? state.timeEntryMode || 'timestamp' : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const duration = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  const timing = completionEnd(start, duration);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; first.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<div className="lmp-dialog-backdrop">
    <form className="lmp-completion-dialog" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="lmp-completion-title"
      onKeyDown={event => {
        if (event.key === 'Escape' && !saving) onClose();
        if (event.key !== 'Tab') return;
        const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)');
        if (!targets?.length) { event.preventDefault(); panel.current?.focus(); return; }
        const head = targets[0]; const tail = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
        else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
      }} onSubmit={async event => {
        event.preventDefault();
        if (duration <= 0 || duration > 28800) { setError('Enter an OTH duration greater than zero and at most 8 hours.'); return; }
        if (!mode || (mode === 'timestamp' && !timing) || (mode === 'input' && !date)) { setError('Choose Input or Timestamp and enter the activity date.'); return; }
        setSaving(true); setError('');
        try {
          await onSave(mode === 'input' ? { durationSeconds: duration, timeEntryMode: 'input', activityDate: date }
            : { durationSeconds: duration, timeEntryMode: 'timestamp', startedAt: timing!.start });
          onClose();
        }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save activity.'); }
        finally { setSaving(false); }
      }}>
      <h2 id="lmp-completion-title">{recording ? 'Record watched recording' : 'Mark activity Completed'}</h2><p>{row.activity.componentTitle}</p>
      <fieldset disabled={saving}><legend>Time entry</legend><div className="lmp-time-modes">
        <label><input ref={first} type="radio" name="time-entry" required checked={mode === 'input'} onChange={() => setMode('input')} />Input<span>Date and OTH only</span></label>
        <label><input type="radio" name="time-entry" required checked={mode === 'timestamp'} onChange={() => setMode('timestamp')} />Timestamp<span>Start time and OTH</span></label>
      </div><p className="lmp-duration-label">OTH duration</p><div className="lmp-duration-fields">
        <label>Hours<input type="number" min="0" max="8" step="1" required value={hours} onChange={event => setHours(event.target.value)} /></label>
        <label>Minutes<input type="number" min="0" max="59" step="1" required value={minutes} onChange={event => setMinutes(event.target.value)} /></label>
        <label>Seconds<input type="number" min="0" max="59" step="1" required value={seconds} onChange={event => setSeconds(event.target.value)} /></label>
      </div>{mode === 'input' && <label>Activity date<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>}
      {mode === 'timestamp' && <><label>Start date and time (UK)<input type="datetime-local" step="1" required value={start} onChange={event => { setStart(event.target.value); setDate(event.target.value.slice(0, 10)); }} /></label>
        <label>Calculated end time (UK)<input readOnly value={timing ? formatSystemTimestamp(timing.end, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''} /></label></>}
      </fieldset>
      <p className="lmp-muted">OTH and time are saved to this activity’s Activity Log. Assessment results, evidence and KSB achievements are preserved.</p>
      {error && <p role="alert" className="lmp-save-error">{error}</p>}
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Completed'}</button></footer>
    </form>
  </div>, document.body);
}
