import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { LearnerKind } from '@/api/learnerDetail';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import {
  bookLearnerCalendarSession, fetchCalendarConnections, fetchLearnerCalendarEvents, fetchPersonalCalendarAvailability,
  rescheduleLearnerCalendarSession, type BookingCalendarRules, type BookSessionResponse,
  type CalendarBusySlot, type LearnerCalendarEvent, type PersonalCalendarConnection,
} from '@/api/learnerCalendar';
import { bookingDateRestrictionMessage, firstAvailableBookingDate, isoDate } from './bookingDates';
import styles from './meetingBooking.module.css';

type Props = {
  session: LearnerCalendarEvent;
  title: string;
  learner: { kind: LearnerKind; id: string };
  rules: BookingCalendarRules | null;
  attendance?: MeetingAttendance;
  onClose: () => void;
  onBooked: (response: BookSessionResponse) => void;
};

function bookingBounds(date: string, time: string, durationMinutes: number) {
  const start = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(start) ? { start, end: start + durationMinutes * 60_000 } : null;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && end > otherStart;
}

/** The compact Book session form shared by the two meeting lists. */
export default function MeetingBookingDialog({ session, title, learner, rules, attendance, onClose, onBooked }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Background list refreshes must not reset a day/time the learner is editing.
  const [initialBooking] = useState({ session, rules, attendance });
  const [target, setTarget] = useState<LearnerCalendarEvent | null>(null);
  const [calendarRules, setCalendarRules] = useState(rules);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(session.scheduledDate || firstAvailableBookingDate(session.targetDate || session.date, rules));
  const [time, setTime] = useState(session.scheduledTime || '09:00');
  const [duration, setDuration] = useState(String(session.durationMinutes || 60));
  const [notes, setNotes] = useState(session.notes || '');
  const [calendarEvents, setCalendarEvents] = useState<LearnerCalendarEvent[]>([]);
  const [connections, setConnections] = useState<PersonalCalendarConnection[]>([]);
  const [busySlots, setBusySlots] = useState<CalendarBusySlot[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const edited = useRef({ date: false, time: false, duration: false, notes: false });
  const mounted = useRef(false);
  const monthly = session.source === 'mcr';
  const meetingType = monthly ? 'monthly coaching' : 'progress review';
  const rescheduling = Boolean(target?.scheduledDate && target.status === 'scheduled');
  const isExisting = rescheduling || Boolean(session.scheduledDate && session.status === 'scheduled');
  const durationLocked = Boolean(session.importedReview?.id && monthly);
  const dateRestriction = bookingDateRestrictionMessage(date, calendarRules);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      mounted.current = false;
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const { session, rules, attendance } = initialBooking;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void Promise.all([
      fetchLearnerCalendarEvents(learner.kind, learner.id, { revalidate: true }),
      fetchCalendarConnections(learner.kind, learner.id).catch(() => ({ connections: [] })),
    ]).then(([calendar, calendarConnections]) => {
      if (cancelled) return;
      const reviewId = session.importedReview?.id;
      const allowedTypes = session.source === 'mcr' ? ['monthly coaching meeting', 'monthly coaching', 'mcm'] : ['progress review', 'progress review (+ skills radar)'];
      if (session.importedReview && !allowedTypes.includes(session.importedReview.type.trim().toLowerCase())) {
        throw new Error('Choose a Monthly Coaching Meeting or Progress Review to schedule.');
      }
      const durableKey = attendance?.calendarEventKey || session.eventKey;
      // Resolve only this learner's exact booking. Dates are not identities.
      const saved = calendar.events.find(event => event.source === session.source && (
        event.eventKey === durableKey || Boolean(reviewId && event.reviewId === reviewId)
      ));
      if (!saved && !reviewId) throw new Error('This meeting is no longer available. Close this window and refresh the page.');
      if (saved && !['scheduled', 'not-scheduled'].includes(saved.status)) {
        throw new Error('This meeting can no longer be scheduled. Close this window and refresh the page.');
      }
      const resolved = saved || session;
      const nextRules = calendar.bookingCalendar || rules;
      setTarget(resolved);
      setCalendarRules(nextRules);
      setCalendarEvents(calendar.events);
      setConnections(calendarConnections.connections);
      if (!edited.current.date) setDate(resolved.scheduledDate || firstAvailableBookingDate(resolved.targetDate || resolved.date, nextRules));
      if (!edited.current.time) setTime(resolved.scheduledTime || '09:00');
      if (!edited.current.duration) setDuration(String(resolved.durationMinutes || 60));
      if (!edited.current.notes) setNotes(resolved.notes || '');
    }).catch(reason => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : 'Could not load this booking. Please try again.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learner.kind, learner.id, initialBooking, revision]);

  useEffect(() => {
    if (!connections.length || !date) {
      setBusySlots([]);
      setAvailabilityError('');
      return;
    }
    const start = new Date(`${date}T00:00:00`).toISOString();
    const end = new Date(`${date}T23:59:59`).toISOString();
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError('');
    void fetchPersonalCalendarAvailability(learner.kind, learner.id, start, end)
      .then(result => {
        if (cancelled) return;
        setBusySlots(result.busy);
        if (result.errors.length) setAvailabilityError('Some connected calendars could not be checked. The server will check again before booking.');
      })
      .catch(() => {
        if (!cancelled) {
          setBusySlots([]);
          setAvailabilityError('Calendar availability could not be refreshed. The server will check again before booking.');
        }
      })
      .finally(() => { if (!cancelled) setAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [connections.length, date, learner.kind, learner.id]);

  const requested = bookingBounds(date, time, Number(duration));
  const lmsConflict = requested ? calendarEvents.find(event => {
    if (event.eventKey === target?.eventKey || event.id === target?.id || event.status === 'cancelled' || !event.scheduledDate || !event.scheduledTime) return false;
    const existing = bookingBounds(event.scheduledDate, event.scheduledTime, event.durationMinutes || 60);
    return existing ? overlaps(requested.start, requested.end, existing.start, existing.end) : false;
  }) : null;
  const personalConflict = requested ? busySlots.find(slot => {
    const start = Date.parse(slot.start), end = Date.parse(slot.end);
    return Number.isFinite(start) && Number.isFinite(end) && overlaps(requested.start, requested.end, start, end);
  }) : null;
  const bookingConflict = lmsConflict || personalConflict;

  function close() { if (!submitting.current) onClose(); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || loading || availabilityLoading || loadError || bookingConflict || !target || !date || !time) return;
    if (dateRestriction) { setError(dateRestriction); return; }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const reviewId = session.importedReview?.id || target.reviewId;
      const eventKey = target.eventKey.startsWith('imported-review:') ? attendance?.calendarEventKey || target.eventKey : target.eventKey;
      // An imported review may have a scheduled date before its first LMS
      // booking. Only a durable calendar key can be sent to reschedule.
      const update = rescheduling && !eventKey.startsWith('imported-review:');
      const input = {
        scheduledDate: date,
        scheduledTime: time,
        durationMinutes: update && target.eventKey.startsWith('imported-review:') ? attendance?.durationMinutes || Number(duration) || 60
          : !update && reviewId && monthly ? 60 : Number(duration) || 60,
        notes: notes.trim() || undefined,
        timezoneOffsetMinutes: new Date(`${date}T${time}:00`).getTimezoneOffset(),
      };
      const response = update
        ? await rescheduleLearnerCalendarSession(learner.kind, learner.id, { ...input, eventKey, reviewId })
        : await bookLearnerCalendarSession(learner.kind, learner.id, {
          ...input, sessionType: monthly ? 'mcr' : 'progress-review',
          eventKey: reviewId ? undefined : eventKey, reviewId,
          assignmentMonth: reviewId ? target.assignmentMonth || (session.targetDate || session.date || date).slice(0, 7) : undefined,
        });
      if (mounted.current) onBooked(response);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save this booking. Please try again.');
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const plannedDate = session.targetDate || session.date;
  const sessionLabel = `${monthly ? 'Monthly Coaching Meeting' : 'Progress Review'}${plannedDate ? ` · ${new Date(`${plannedDate}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`;
  const calendarHref = `/learner/calendar?kind=${encodeURIComponent(learner.kind)}&learner=${encodeURIComponent(learner.id)}&connect=calendar`;
  const canSubmit = !loading && !saving && !availabilityLoading && !loadError && !dateRestriction && !bookingConflict && Boolean(target && date && time);
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} className={styles.dialog}
    onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={submit} aria-busy={loading || saving}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{monthly ? 'Monthly coaching booking' : 'Progress review booking'}</p>
          <h2 id={titleId}>{isExisting ? 'Reschedule' : 'Book'} {meetingType}</h2>
          <p id={descriptionId} className={styles.description}>Choose the day and time for {title}.</p></div>
        <button type="button" aria-label="Close booking dialog" className={styles.close} onClick={close} disabled={saving}><AppIcon className="ri-close-line" /></button>
      </header>
      <label className={styles.session}>Session<select aria-label="Session" value={session.id} onChange={() => undefined} disabled={saving}>
        <option value={session.id}>{sessionLabel}</option>
      </select></label>
      <div className={styles.fields}>
        <label>Date<input aria-label="Day" type="date" required min={isoDate(new Date())} value={date} disabled={saving || Boolean(loadError)} onChange={event => { edited.current.date = true; setDate(event.target.value); setError(''); }} /></label>
        <label>Time<input type="time" required value={time} disabled={saving || Boolean(loadError)} onChange={event => { edited.current.time = true; setTime(event.target.value); setError(''); }} /></label>
      </div>
      <div className={`${styles.calendarCheck} ${bookingConflict ? styles.calendarConflict : ''}`}>
        <AppIcon className="ri-calendar-line" />
        <div>
          {!connections.length
            ? <Link to={calendarHref}>Connect your personal calendar to prevent booking conflicts</Link>
            : availabilityLoading
              ? <p role="status">Checking your personal calendar…</p>
              : bookingConflict
                ? <p>This time conflicts with {lmsConflict ? `“${lmsConflict.title}”` : 'an event in your personal calendar'}.</p>
                : <p>This time is available in your calendar.</p>}
          {connections.length > 0 && <small>{connections.length} personal calendar{connections.length === 1 ? '' : 's'} connected</small>}
        </div>
      </div>
      <label className={styles.duration}>Duration
        <select aria-label="Duration" value={duration} disabled={durationLocked || saving || Boolean(loadError)} onChange={event => { edited.current.duration = true; setDuration(event.target.value); setError(''); }}>
          {[30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : minutes === 60 ? '1 hour' : `${minutes / 60} hours`}</option>)}
          {![30, 45, 60, 90, 120].includes(Number(duration)) && <option value={duration}>{duration} minutes</option>}
        </select>
      </label>
      <label className={styles.notes}>What would you like to cover? <span>(optional)</span>
        <textarea maxLength={500} value={notes} disabled={saving || Boolean(loadError)} onChange={event => { edited.current.notes = true; setNotes(event.target.value); }} placeholder="Add anything your coach should know before the session…" />
        <small>{notes.length}/500</small>
      </label>
      {loadError && <p role="alert" className={styles.error}>{loadError} <button type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></p>}
      {!loading && !loadError && (error || dateRestriction || availabilityError) && <p role="alert" className={styles.error}>{error || dateRestriction || availabilityError}</p>}
      <footer className={styles.footer}>
        <button type="button" onClick={close} disabled={saving}>Cancel</button>
        <button type="submit" aria-label={saving ? 'Saving' : isExisting ? 'Save new time' : 'Book session'} className={styles.primary} disabled={!canSubmit}>{saving ? 'Saving…' : isExisting ? 'Save new time' : 'Send request'}</button>
      </footer>
    </form>
  </dialog>, document.body);
}
