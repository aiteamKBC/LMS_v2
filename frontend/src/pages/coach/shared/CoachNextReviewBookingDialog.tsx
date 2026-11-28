import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  scheduleCoachCalendarEvent, scheduleDefaults, type CoachCalendarEvent,
} from './calendarEvents';

export function CoachNextReviewBookingDialog({ event, onClose, onBooked }: {
  event: CoachCalendarEvent;
  onClose: () => void;
  onBooked: (event: CoachCalendarEvent, warning?: string) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const [form, setForm] = useState(() => scheduleDefaults(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const save = async () => {
    if (savingRef.current || !form.date || !form.time || !Number.isInteger(form.durationMinutes)
        || form.durationMinutes < 15 || form.durationMinutes > 480) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await scheduleCoachCalendarEvent(event, form);
      onBooked(result.event, result.warning);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to book this review.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-busy={saving}
      onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-[620px] overflow-y-auto rounded-2xl border border-foreground-200 bg-white p-0 shadow-2xl backdrop:bg-black/55">
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="flex items-start justify-between border-b border-foreground-100 px-5 py-4">
          <div><p className="text-xs font-semibold text-primary-600">Microsoft Teams booking</p>
            <h2 id={titleId} className="mt-1 text-xl font-bold text-foreground-900">Book next {event.reviewTypeCode === 'mcm' ? 'Monthly Coaching Meeting' : 'Progress Review'}</h2></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close booking" className="rounded-lg px-3 py-1 text-xl text-foreground-500 disabled:opacity-50">×</button>
        </div>
        <div className="space-y-4 p-5">
          <p className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-900">{event.title || 'Next review'} · {event.learner || 'Learner'}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-semibold text-foreground-700">Date<input type="date" required value={form.date} onChange={change => setForm(current => ({ ...current, date: change.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-sm" /></label>
            <label className="text-xs font-semibold text-foreground-700">Time · UK time<input type="time" required value={form.time} onChange={change => setForm(current => ({ ...current, time: change.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-sm" /></label>
            <label className="text-xs font-semibold text-foreground-700">Duration (minutes)<input type="number" required min={15} max={480} step={1} value={form.durationMinutes} onChange={change => setForm(current => ({ ...current, durationMinutes: Number(change.target.value) }))} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-sm" /></label>
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-foreground-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-foreground-200 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || !form.date || !form.time || form.durationMinutes < 15 || form.durationMinutes > 480} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Booking...' : 'Confirm booking'}</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
