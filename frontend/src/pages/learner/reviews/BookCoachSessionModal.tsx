import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  bookLearnerCalendarSession, fetchLearnerCalendarEvents, fetchLearnerCoach,
  type BookingCalendarRules, type BookSessionResponse,
} from '@/api/learnerCalendar';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import CoachSessionTypePicker, { type CoachSessionRequestType } from '../calendar/CoachSessionTypePicker';
import { bookingDateRestrictionMessage, firstAvailableBookingDate, isoDate } from './bookingDates';

/** General coach requests use the calendar booking API without a programme slot identity. */
export default function BookCoachSessionModal({ defaultSessionType, onClose, onBooked }: {
  defaultSessionType: 'progress-review' | 'mcr';
  onClose: () => void;
  onBooked: () => void;
}) {
  const learner = useLinkedLearner();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const savingRef = useRef(false);
  closeRef.current = onClose;
  const [sessionType, setSessionType] = useState<CoachSessionRequestType>(defaultSessionType);
  const [date, setDate] = useState(() => firstAvailableBookingDate());
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [otherType, setOtherType] = useState('');
  const [coach, setCoach] = useState<{ coachName: string; coachEmail: string } | null>(null);
  const [rules, setRules] = useState<BookingCalendarRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BookSessionResponse | null>(null);
  const restriction = bookingDateRestrictionMessage(date, rules);
  const close = () => { if (!savingRef.current) onClose(); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([
      fetchLearnerCalendarEvents(learner.kind, learner.id, { revalidate: true }),
      fetchLearnerCoach(learner.id),
    ]).then(([calendar, assignedCoach]) => {
      if (cancelled) return;
      setRules(calendar.bookingCalendar || null);
      setCoach(assignedCoach);
      setDate(current => firstAvailableBookingDate(current, calendar.bookingCalendar));
    }).catch(reason => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : 'Could not load booking details.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learner.kind, learner.id, revision]);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current!;
    document.body.style.overflow = 'hidden';
    dialog.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!savingRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'))
        .filter(control => !control.matches(':disabled'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.removeEventListener('keydown', onKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || loading || loadError || !coach?.coachEmail || !date || !time || restriction) return;
    if (sessionType === 'other' && !otherType.trim()) {
      setError('Please enter the type of session you need.');
      return;
    }
    savingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const requestNotes = sessionType === 'other'
        ? [`Requested session type: ${otherType.trim()}`, notes.trim()].filter(Boolean).join('\n')
        : notes.trim();
      const response = await bookLearnerCalendarSession(learner.kind, learner.id, {
        sessionType,
        scheduledDate: date,
        scheduledTime: time,
        durationMinutes: Number(duration),
        notes: requestNotes || undefined,
        timezoneOffsetMinutes: new Date(`${date}T${time}:00`).getTimezoneOffset(),
      });
      setResult(response);
      onBooked();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your booking request.');
    } finally {
      savingRef.current = false;
      setSubmitting(false);
    }
  }

  const fieldClass = 'mt-1.5 w-full rounded-lg border border-background-300 bg-background-100 px-3 py-2 text-sm font-normal text-foreground-800 outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200';
  const calendarQuery = new URLSearchParams({ kind: learner.kind, learner: learner.id });
  if (result) {
    calendarQuery.set('event', result.event.eventKey || result.event.id);
    calendarQuery.set('date', date);
  }

  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-background-50 p-6 shadow-xl outline-none">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-2 text-lg font-bold text-foreground-900"><AppIcon className="ri-user-star-line text-primary-500" />Book a Coach Session</h2>
        <button type="button" aria-label="Close session booking" disabled={submitting} onClick={close} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100"><AppIcon className="ri-close-line" /></button>
      </div>
      {result ? <>
        <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {result.approvalRequired ? `Your session request has been sent to ${coach?.coachName || 'your coach'} for approval.` : 'Your session has been booked.'}
          <p className="mt-2 font-semibold">{date} at {time} · {duration} minutes</p>
        </div>
        {result.warning && <p role="alert" className="mt-3 text-sm text-amber-800">{result.warning}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={close} className="flex-1 rounded-xl border border-background-300 px-4 py-2.5 text-sm font-semibold text-foreground-600">Done</button>
          <Link to={`/learner/calendar?${calendarQuery}`} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 text-center text-sm font-semibold text-white">View in calendar</Link>
        </div>
      </> : <>
        <p className="mb-5 text-sm text-foreground-500">Choose the session you need. Your request will be sent to {coach?.coachName || 'your coach'} for approval.</p>
        {loading && <p role="status" className="mb-4 text-sm text-foreground-500">Loading booking details…</p>}
        {loadError && <p role="alert" className="mb-4 text-sm text-red-700">{loadError} <button type="button" onClick={() => setRevision(value => value + 1)} className="font-bold underline">Try again</button></p>}
        {!loading && !loadError && !coach?.coachEmail && <p role="alert" className="mb-4 text-sm text-amber-800">No coach has been assigned to you yet. Please contact your programme team.</p>}
        <form onSubmit={submit}>
          <fieldset disabled={submitting} className="space-y-4">
            <div><p className="mb-1.5 text-xs font-semibold text-foreground-500">Session Type <span className="text-red-400">*</span></p><CoachSessionTypePicker value={sessionType} onChange={value => { setSessionType(value); setError(''); }} /></div>
            {sessionType === 'other' && <label className="block text-xs font-semibold text-foreground-500">Other <span className="text-red-400">*</span><input type="text" required value={otherType} onChange={event => { setOtherType(event.target.value); setError(''); }} maxLength={100} placeholder="Write the session type you need" className={fieldClass} /></label>}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-foreground-500">Date <span className="text-red-400">*</span><input type="date" required min={isoDate(new Date())} value={date} onChange={event => { setDate(event.target.value); setError(''); }} className={fieldClass} /></label>
              <label className="text-xs font-semibold text-foreground-500">Time <span className="text-red-400">*</span><input type="time" required value={time} onChange={event => { setTime(event.target.value); setError(''); }} className={fieldClass} /></label>
            </div>
            {restriction && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">{restriction}</p>}
            <label className="block text-xs font-semibold text-foreground-500">Duration<select value={duration} onChange={event => { setDuration(event.target.value); setError(''); }} className={fieldClass}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option></select></label>
            <label className="block text-xs font-semibold text-foreground-500">What would you like to cover? (optional)<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} rows={3} placeholder="Add anything your coach should know before the session..." className={`${fieldClass} resize-none`} /><span className="mt-0.5 block text-[10px] font-normal text-foreground-400">{notes.length}/500</span></label>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</p>}
          </fieldset>
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={submitting} onClick={close} className="flex-1 rounded-xl border border-background-300 px-4 py-2.5 text-sm font-semibold text-foreground-600 hover:bg-background-100">Cancel</button>
            <button type="submit" disabled={submitting || loading || Boolean(loadError) || !coach?.coachEmail || !date || !time || Boolean(restriction)} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Sending…' : 'Send Request'}</button>
          </div>
        </form>
      </>}
    </div>
  </div>, document.body);
}
