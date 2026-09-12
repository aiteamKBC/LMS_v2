import { CoachMeetingArtifactsPanel } from '@/pages/coach/shared/CoachMeetingArtifactsPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, fetchLearnerMeetingArtifacts, learnerMeetingArtifactContentUrl, type LearnerCalendarResponse } from '@/api/learnerCalendar';

export function AssignmentCoachingBooking({ kind, learnerId, month, title, meetingKey, disabled, onSave, onSelect }: {
  kind: LearnerKind; learnerId: string; month: string; title: string; meetingKey: string; disabled: boolean;
  onSave: () => Promise<boolean>; onSelect: (key: string) => void;
}) {
  const loadArtifacts = useCallback((key: string, signal?: AbortSignal) => fetchLearnerMeetingArtifacts(kind, learnerId, key, signal), [kind, learnerId]);
  const contentUrl = useCallback((key: string, type: string, id: string, options: { preview?: boolean } = {}) => learnerMeetingArtifactContentUrl(kind, learnerId, key, type, id, options), [kind, learnerId]);
  const [calendar, setCalendar] = useState<LearnerCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [slotKey, setSlotKey] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const booking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef({ kind, learnerId, month, onSelect });
  latest.current = { kind, learnerId, month, onSelect };
  const [reload, setReload] = useState(0);
  const endDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const minDate = `${month}-${String(endDay - 9).padStart(2, '0')}`;
  const nextMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 5);
  const maxDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-05`;
  const events = calendar?.events || [];
  const booked = events.filter(e => e.source === 'mcr' && ['scheduled', 'in-progress', 'completed', 'awaiting-signature'].includes(e.status) && (e.scheduledDate || '') >= minDate && (e.scheduledDate || '') <= maxDate);
  const slots = events.filter(e => e.source === 'mcr' && e.status === 'not-scheduled' && (e.targetDate || e.date || '').slice(0, 7) === month);
  const slot = slots.find(e => e.eventKey === slotKey);
  const selected = booked.find(e => e.eventKey === meetingKey);
  useEffect(() => {
    let active = true;
    setLoading(true); setCalendar(null); setSlotKey(''); setDate(''); setError(''); setNotice('');
    fetchLearnerCalendarEvents(kind, learnerId, { force: true }).then(result => {
      if (active) { setCalendar(result); setLoading(false); }
    }).catch(e => { if (active) { setError(e.message || 'Could not load coaching meetings.'); setLoading(false); } });
    return () => { active = false; };
  }, [kind, learnerId, month, reload]);
  const restriction = () => {
    if (!date) return '';
    const parsed = new Date(`${date}T12:00:00`);
    if (!Number.isFinite(parsed.getTime())) return 'Choose a valid date.';
    if (date < minDate || date > maxDate) return 'Choose a date from the last ten days of the submission month through the 5th of the following month.';
    const today = calendar?.bookingCalendar?.today || new Date().toLocaleDateString('sv-SE');
    if (date < today) return 'Sessions cannot be booked on a date that has already passed.';
    if ([0, 6].includes(parsed.getDay())) return 'Sessions cannot be booked on Saturdays or Sundays.';
    const holiday = calendar?.bookingCalendar?.bankHolidays.find(h => h.date === date);
    if (holiday) return `Sessions cannot be booked on UK bank holidays (${holiday.title}).`;
    if (calendar?.bookingCalendar && !calendar.bookingCalendar.coveredYears.includes(parsed.getFullYear())) return 'The bank-holiday calendar is not available for this year.';
    return '';
  };
  const dateError = restriction();
  const book = async () => {
    if (disabled || booking.current || (slots.length > 0 && !slot) || !date || !time || dateError) return;
    booking.current = true; setBusy(true); setError(''); setNotice('');
    const identity = { kind, learnerId, month };
    try {
      if (!await onSave()) { setError('Save your assignment draft before booking.'); return; }
      if (!mounted.current || Object.keys(identity).some(k => identity[k as keyof typeof identity] !== latest.current[k as keyof typeof identity])) return;
      const result = await bookLearnerCalendarSession(kind, learnerId, {
        sessionType: 'mcr', eventKey: slot?.eventKey, assignmentMonth: month, scheduledDate: date, scheduledTime: time,
        durationMinutes: 60, timezoneOffsetMinutes: new Date(`${date}T${time}`).getTimezoneOffset(), notes: `Monthly assignment: ${title}`,
      });
      if (!mounted.current || Object.keys(identity).some(k => identity[k as keyof typeof identity] !== latest.current[k as keyof typeof identity])) return;
      setCalendar(current => current ? { ...current, events: [...current.events.filter(e => e.eventKey !== result.event.eventKey), result.event] } : current);
      latest.current.onSelect(result.event.eventKey); setSlotKey('');
      setNotice(result.warning ? `Booking saved. ${result.warning}` : result.event.invited === false ? 'Booking saved, but the calendar invitation has not been sent. Contact your coach.' : 'Your Monthly Coaching Meeting is booked and linked to this assignment.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not book your meeting.'); }
    finally { booking.current = false; setBusy(false); }
  };
  const input = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm disabled:bg-slate-50';
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <div><h4 className="text-base font-semibold">Arrange your Monthly Coaching Meeting</h4><p className="mt-2 text-sm leading-6 text-slate-600">Use a booked MCM or book a monthly session with your assigned coach below. The same booking appears in your calendar and your coach's calendar.</p></div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading coaching meetings...</p>}
    {!loading && <>
      <label className="block">Use an existing coaching booking<select className={input} value={meetingKey} disabled={disabled || busy} onChange={e => onSelect(e.target.value)}><option value="">Select a booked meeting</option>{booked.map(e => <option key={e.eventKey} value={e.eventKey}>{e.scheduledDate} {e.scheduledTime} ? {e.coachName}</option>)}</select></label>
      {!booked.length && <p className="text-sm text-slate-500">No booked MCM falls between {minDate} and {maxDate}.</p>}
      {selected && <div className="rounded-xl bg-blue-50 p-4 text-sm"><p>Linked meeting: {selected.scheduledDate} at {selected.scheduledTime} with {selected.coachName}.</p>{selected.invited === false && <p className="mt-2 text-amber-800">The meeting is saved, but the calendar invitation has not been sent. Contact your coach.</p>}</div>}
      {selected && <div className="space-y-3">
        {selected.meetingLink && /^https:\/\//i.test(selected.meetingLink) && <a href={selected.meetingLink} target="_blank" rel="noreferrer" className="inline-flex rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Join MCM</a>}
        <p className="text-sm leading-6 text-slate-600">Recording and transcription are enabled automatically using the live-session settings. The recording, transcript and attendance appear here once Teams has processed them after the meeting.</p>
        <CoachMeetingArtifactsPanel event={selected} fetchArtifacts={loadArtifacts} contentUrl={contentUrl} showAttendance />
      </div>}
      {(slots.length > 0 || booked.length === 0) && <fieldset disabled={disabled || busy || !calendar} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <legend className="px-2 text-sm font-semibold">Schedule an official MCM</legend>
        <>
          {slots.length > 0 && <label className="block">Monthly Coaching Meeting slot<select className={input} value={slotKey} onChange={e => setSlotKey(e.target.value)}><option value="">Select your programme MCM</option>{slots.map(e => <option key={e.eventKey} value={e.eventKey}>{e.title} ? target {e.targetDate || e.date} ? {e.coachName}</option>)}</select></label>}
          <p className="text-sm leading-6 text-slate-600">Choose a weekday between {minDate} and {maxDate}. Times use your browser's timezone. Calendar conflicts and bank holidays are checked by the same MCM booking service.</p>
          <div className="grid gap-4 sm:grid-cols-2"><label>Date<input type="date" className={input} min={minDate} max={maxDate} value={date} onChange={e => setDate(e.target.value)} /></label><label>Time<input type="time" className={input} value={time} onChange={e => setTime(e.target.value)} /></label></div>
          {dateError && <p role="alert" className="text-sm text-red-700">{dateError}</p>}
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40" disabled={(slots.length > 0 && !slot) || !date || !time || Boolean(dateError)} onClick={() => void book()}>{busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{busy ? 'Booking MCM...' : 'Book 60-minute MCM'}</button>
        </>
      </fieldset>}
      <button type="button" disabled={busy} className="text-sm font-medium text-blue-700 underline" onClick={() => setReload(n => n + 1)}>Refresh meetings</button>
    </>}
    {notice && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  </section>;
}
