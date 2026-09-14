import { useEffect, useState } from 'react';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, type BookingCalendarRules, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MissedAttendanceSession } from '@/api/absenceReports';
import { useMyLearner } from '@/hooks/useMyLearner';
import styles from '../attendance.module.css';

export default function CatchupBooking({ lecture, selectedKey, onSelect, onBusyChange, disabled = false, standalone = false }: {
  lecture: MissedAttendanceSession;
  selectedKey: string;
  onSelect: (event: LearnerCalendarEvent | null) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  standalone?: boolean;
}) {
  const learner = useMyLearner();
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [rules, setRules] = useState<BookingCalendarRules>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const today = rules?.today || new Date().toLocaleDateString('en-CA');
  const earliestDate = lecture.dateIso > today ? lecture.dateIso : today;
  const available = events.filter(event => event.source === 'catch-up'
    && ['scheduled', 'not-scheduled', 'in-progress'].includes(event.status)
    && event.scheduledDate && event.scheduledDate >= earliestDate && event.scheduledTime
    && new Date(`${event.scheduledDate}T${event.scheduledTime}`).getTime() > Date.now());
  const selected = available.find(event => event.eventKey === selectedKey);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchLearnerCalendarEvents(learner.kind, learner.id, { revalidate: true }).then(result => {
      if (cancelled) return;
      setEvents(result.events);
      setRules(result.bookingCalendar);
    }).catch(reason => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : 'Could not load catch-up bookings.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learner.kind, learner.id, revision]);

  useEffect(() => {
    if (!loading && !loadError && selectedKey && !selected) onSelect(null);
  }, [loading, loadError, selectedKey, selected, onSelect]);

  const book = async () => {
    if (busy || disabled) return;
    setError('');
    setNotice('');
    const start = new Date(`${date}T${time}`);
    if (!date || !time || !Number.isFinite(start.getTime()) || date < earliestDate || start.getTime() <= Date.now()) {
      setError('Choose a future date and time on or after the lecture date.'); return;
    }
    if ([0, 6].includes(start.getDay())) { setError('Choose a weekday for your catch-up session.'); return; }
    const holiday = rules?.bankHolidays.find(day => day.date === date);
    if (holiday) { setError(`Sessions cannot be booked on ${holiday.title}.`); return; }
    if (rules && !rules.coveredYears.includes(start.getFullYear())) { setError('Booking is not available for this year.'); return; }
    setBusy(true); onBusyChange(true);
    try {
      const result = await bookLearnerCalendarSession(learner.kind, learner.id, {
        sessionType: 'catch-up', scheduledDate: date, scheduledTime: time, durationMinutes: Number(duration),
        timezoneOffsetMinutes: start.getTimezoneOffset(),
        notes: `Catch-up for lecture: ${lecture.title}\nLecture date: ${lecture.dateIso}`,
      });
      if (!result.event?.eventKey || result.event.source !== 'catch-up'
        || !['scheduled', 'not-scheduled', 'in-progress'].includes(result.event.status)
        || !result.event.scheduledDate || !result.event.scheduledTime) throw new Error('The session was not booked. Please refresh your bookings before retrying.');
      setEvents(current => [...current.filter(event => event.eventKey !== result.event.eventKey), result.event]);
      onSelect(result.event);
      setNotice(result.warning || (result.approvalRequired || result.event.status === 'not-scheduled'
        ? `Catch-up request saved. Awaiting coach approval.${standalone ? '' : ' You can now submit your absence report.'}`
        : `Catch-up session booked.${standalone ? '' : ' You can now submit your absence report.'}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not book the catch-up session.'); }
    finally { setBusy(false); onBusyChange(false); }
  };

  return <div className={styles.catchupBooking} aria-busy={busy || loading}>
    <div className={styles.bookingHeading}><strong>Your catch-up session</strong><button type="button" disabled={busy || loading || disabled} onClick={() => setRevision(value => value + 1)}>Refresh bookings</button></div>
    {loading && <p role="status">Loading your bookings…</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!loading && available.length > 0 && <label>Use an existing catch-up booking
      <select aria-label="Catch-up booking" disabled={busy || disabled} value={selected?.eventKey || ''} onChange={event => { setNotice(''); onSelect(available.find(item => item.eventKey === event.target.value) || null); }}>
        <option value="">Choose a session or book below</option>
        {available.map(event => <option key={event.eventKey} value={event.eventKey}>{event.scheduledDate} at {event.scheduledTime} · {event.coachName || 'Your coach'}{event.status === 'not-scheduled' ? ' (Awaiting approval)' : ''}</option>)}
      </select>
    </label>}
    {selected ? <p className={styles.bookingConfirmation}>{selected.scheduledDate} at {selected.scheduledTime} · {selected.durationMinutes} minutes{selected.status === 'not-scheduled' ? ' · Awaiting coach approval' : ' · Booked'}</p> : <>
      <p>{standalone ? 'Choose a date and time to catch up on this lecture.' : 'Book a session before submitting.'} Your coach will review the booking request.</p>
      <div className={styles.bookingFields}>
        <label>Date<input aria-label="Catch-up date" type="date" min={earliestDate} value={date} disabled={busy || disabled} onChange={event => setDate(event.target.value)} /></label>
        <label>Time<input aria-label="Catch-up time" type="time" value={time} disabled={busy || disabled} onChange={event => setTime(event.target.value)} /></label>
        <label>Duration<select aria-label="Catch-up duration" value={duration} disabled={busy || disabled} onChange={event => setDuration(event.target.value)}><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label>
      </div>
      <button type="button" className={`primary-action ${styles.bookCatchupButton}`} disabled={busy || loading || disabled || !date || !time} onClick={book}>{busy ? 'Booking…' : 'Book Catch-up Session'}</button>
    </>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
