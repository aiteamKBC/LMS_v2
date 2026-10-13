import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProgressRow } from './progressView';
import type { CurriculumActivityCompletionTime } from '@/lib/curriculumApi';

export default function AttendanceDialog({ row, onClose, onRecording, onSave }: {
  row: ProgressRow; onClose: () => void; onRecording: () => void;
  onSave: (values: CurriculumActivityCompletionTime) => Promise<void>;
}) {
  const lectureDate = 'lectureDate' in row.activity ? row.activity.lectureDate : null;
  const [choice, setChoice] = useState<'attended' | 'recording' | ''>('');
  const [date, setDate] = useState(lectureDate || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; first.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<div className="lmp-dialog-backdrop">
    <form className="lmp-completion-dialog" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="lmp-attendance-title"
      onKeyDown={event => {
        if (event.key === 'Escape' && !saving) onClose();
        if (event.key !== 'Tab') return;
        const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        if (!targets?.length) { event.preventDefault(); panel.current?.focus(); return; }
        const head = targets[0]; const tail = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
        else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
      }} onSubmit={async event => {
        event.preventDefault();
        if (choice === 'recording') { onRecording(); return; }
        if (choice !== 'attended' || !date) { setError('Choose attendance and enter the lecture date.'); return; }
        setSaving(true); setError('');
        try { await onSave({ attendanceMode: 'attended', durationSeconds: 9000, timeEntryMode: 'input', activityDate: date }); onClose(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save attendance.'); }
        finally { setSaving(false); }
      }}>
      <h2 id="lmp-attendance-title">Record attendance</h2><p>{row.activity.componentTitle}</p>
      <fieldset disabled={saving}><legend>Did the learner attend or watch the recording?</legend>
        <div className="lmp-time-modes">
          <label><input ref={first} type="radio" name="attendance-choice" required checked={choice === 'attended'} onChange={() => setChoice('attended')} />Attended<span>Credit 2h 30m for the lecture</span></label>
          <label><input type="radio" name="attendance-choice" required checked={choice === 'recording'} onChange={() => setChoice('recording')} />Watched recording<span>Enter Input or Timestamp and OTH</span></label>
        </div>
        {choice === 'attended' && (lectureDate ? <p>Lecture date: <strong>{lectureDate}</strong></p>
          : <label>Lecture date<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>)}
      </fieldset>
      {error && <p role="alert" className="lmp-save-error">{error}</p>}
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !choice}>{saving ? 'Saving…' : choice === 'attended' ? 'Save Attended' : 'Continue'}</button></footer>
    </form>
  </div>, document.body);
}
