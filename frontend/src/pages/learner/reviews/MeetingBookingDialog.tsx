import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { LearnerKind } from '@/api/learnerDetail';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import {
  bookLearnerCalendarSession, fetchLearnerCalendarEvents, rescheduleLearnerCalendarSession,
  type BookingCalendarRules, type BookSessionResponse, type LearnerCalendarEvent,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const mounted = useRef(false);
  const monthly = session.source === 'mcr';
  const meetingType = monthly ? 'monthly coaching' : 'progress review';
  const rescheduling = Boolean(target?.scheduledDate && target.status === 'scheduled');
  const isExisting = rescheduling || Boolean(session.scheduledDate && session.status === 'scheduled');
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
    void fetchLearnerCalendarEvents(learner.kind, learner.id, { revalidate: true }).then(calendar => {
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
      setDate(resolved.scheduledDate || firstAvailableBookingDate(resolved.targetDate || resolved.date, nextRules));
      setTime(resolved.scheduledTime || '09:00');
    }).catch(reason => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : 'Could not load this booking. Please try again.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learner.kind, learner.id, initialBooking, revision]);

  function close() { if (!submitting.current) onClose(); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || loading || loadError || !target || !date || !time) return;
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
        durationMinutes: update && target.eventKey.startsWith('imported-review:') ? attendance?.durationMinutes || target.durationMinutes || 60
          : !update && reviewId && monthly ? 60 : target.durationMinutes || 60,
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
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} className={styles.dialog}
    onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={submit} aria-busy={saving}>
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
        <label>Day<input type="date" required min={isoDate(new Date())} value={date} disabled={loading || saving || Boolean(loadError)} onChange={event => { setDate(event.target.value); setError(''); }} /></label>
        <label>Time<input type="time" required value={time} disabled={loading || saving || Boolean(loadError)} onChange={event => { setTime(event.target.value); setError(''); }} /></label>
      </div>
      {loading && <p role="status" className={styles.message}>Loading booking…</p>}
      {loadError && <p role="alert" className={styles.error}>{loadError} <button type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></p>}
      {!loading && !loadError && (error || dateRestriction) && <p role="alert" className={styles.error}>{error || dateRestriction}</p>}
      <footer className={styles.footer}>
        <button type="button" onClick={close} disabled={saving}>Cancel</button>
        <button type="submit" className={styles.primary} disabled={loading || saving || Boolean(loadError || dateRestriction) || !date || !time}>{saving ? 'Saving…' : isExisting ? 'Save new time' : 'Book session'}</button>
      </footer>
    </form>
  </dialog>, document.body);
}
