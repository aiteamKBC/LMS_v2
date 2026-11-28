import { LoadingControl, LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { meetingCalendarHref, occupiesBookingSlot } from '@/pages/learner/reviews/meetingBooking';
import { Link } from 'react-router-dom';
import { loadAssignmentTopicStates, type AssignmentTopicState } from '@/api/assignmentTopics';
import { BookingDatePicker } from './BookingDatePicker';
import { CoachMeetingArtifactsPanel } from '@/pages/coach/shared/CoachMeetingArtifactsPanel';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, fetchLearnerMeetingRecordings, fetchReviewSlots, learnerMeetingArtifactContentUrl, type LearnerCalendarResponse } from '@/api/learnerCalendar';
import { fetchReviewHistory, type ImportedReview } from '@/api/reviewHistory';

const CLOSED_REVIEW_STATUSES = ['completed', 'cancelled', 'awaiting-signature'];
const BOOKED_REVIEW_STATUSES = ['scheduled', 'in-progress', 'completed', 'awaiting-signature'];
const TIMELINE_DIALOG_KEY = 'programme-mcm-timeline';

function plannedDateLabel(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date TBC';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Date TBC' : new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

const reviewStatusLabels: Record<string, string> = {
  'not-scheduled': 'Planned', scheduled: 'Scheduled', 'in-progress': 'In progress',
  'awaiting-signature': 'Awaiting signatures', completed: 'Completed', cancelled: 'Cancelled',
  confirmed: 'Confirmed', pending: 'Pending',
};

export function AssignmentCoachingBooking({ kind, learnerId, month, title, meetingKey, assignmentId, topicId, disabled, onSave, onSelect }: {
  kind: LearnerKind; learnerId: string; month: string; title: string; meetingKey: string; disabled: boolean;
  assignmentId?: string; topicId?: string;
  onSave: () => Promise<boolean>; onSelect: (key: string) => void;
}) {
  const loadArtifacts = useCallback((key: string, signal?: AbortSignal) => fetchLearnerMeetingRecordings(kind, learnerId, key, signal), [kind, learnerId]);
  const contentUrl = useCallback((key: string, type: string, id: string, options: { preview?: boolean } = {}) => learnerMeetingArtifactContentUrl(kind, learnerId, key, type, id, options), [kind, learnerId]);
  const [calendar, setCalendar] = useState<LearnerCalendarResponse | null>(null);
  const [importedMcms, setImportedMcms] = useState<ImportedReview[]>([]);
  const [topicStates, setTopicStates] = useState<AssignmentTopicState[]>([]);
  const [bookedHere, setBookedHere] = useState('');
  const [changingMeeting, setChangingMeeting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [slotKey, setSlotKey] = useState('');
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const dialogKeyRef = useRef(dialogKey);
  dialogKeyRef.current = dialogKey;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogTitleId = useId();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [busy, setBusy] = useState(false);
  const booking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef({ kind, learnerId, month, assignmentId, topicId, onSelect });
  latest.current = { kind, learnerId, month, assignmentId, topicId, onSelect };
  const [reload, setReload] = useState(0);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  // MCMs are available throughout the month, subject to the server's weekday,
  // UK bank-holiday and past-date rules and the coach's availability.
  const today = calendar?.bookingCalendar?.today || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' });
  const lastYear = Math.max(Number(today.slice(0, 4)), ...(calendar?.bookingCalendar?.coveredYears || []));
  const selectableDates: string[] = [];
  for (const day = new Date(`${today}T12:00:00Z`); day.getUTCFullYear() <= lastYear; day.setUTCDate(day.getUTCDate() + 1)) {
    const value = day.toISOString().slice(0, 10);
    if ([0, 6].includes(day.getUTCDay())) continue;
    if (calendar?.bookingCalendar?.bankHolidays.some(holiday => holiday.date === value)) continue;
    if (calendar?.bookingCalendar && !calendar.bookingCalendar.coveredYears.includes(day.getUTCFullYear())) continue;
    selectableDates.push(value);
  }
  const events = calendar?.events || [];
  // A reserved slot can still be awaiting reconciliation. Match the assignment
  // check's booking states rather than treating occupancy as confirmation.
  const booked = events.filter(e => e.source === 'mcr' && e.scheduledDate
    && BOOKED_REVIEW_STATUSES.includes(e.calendarEventKey ? e.bookingStatus || e.status : e.status)
    && (e.reviewSource !== 'aptem' || e.calendarEventKey || BOOKED_REVIEW_STATUSES.includes(e.sourceStatus || e.status)));
  // Learners with imported Aptem MCMs get no Curriculum MCMs on their coach's
  // timetable, so only their Aptem MCMs can be booked here.
  const aptemSourced = importedMcms.some(review => review.aptemReviewId);
  const aptemPlan = importedMcms.filter(review => review.aptemReviewId).sort((a, b) =>
    (a.plannedDate || a.completedDate || '9999-12-31').localeCompare(b.plannedDate || b.completedDate || '9999-12-31')
    || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const slots: { key: string; label: string; plannedDate?: string | null; eventKey?: string; reviewId?: string }[] = aptemSourced
    ? importedMcms.filter(review => review.aptemReviewId && !review.completedDate && !CLOSED_REVIEW_STATUSES.includes(review.status)
        // Every imported MCM is also a calendar event; only a linked booking takes it.
        && !events.some(e => e.reviewId === review.id && e.calendarEventKey && occupiesBookingSlot(e)))
      .sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || ''))
      .map(review => ({ key: `imported-review:${review.id}`, reviewId: review.id, plannedDate: review.plannedDate,
        label: `MCM ${(review.plannedDate || '').slice(0, 7)} | Aptem plan ${review.plannedDate}` }))
    : events.filter(e => e.source === 'mcr' && e.status === 'not-scheduled' && !occupiesBookingSlot(e))
      .sort((a, b) => (a.targetDate || a.date || '').localeCompare(b.targetDate || b.date || ''))
      .map(e => ({ key: e.eventKey, eventKey: e.eventKey, plannedDate: e.targetDate || e.date,
        label: `MCM ${(e.targetDate || e.date || '').slice(0, 7)} | ${e.coachName}` }));
  const slot = slots.find(e => e.key === slotKey);
  const needsSlot = slots.length > 0 || aptemSourced;
  const selectedKey = topicId ? bookedHere || meetingKey : meetingKey;
  const shared = topicId && !disabled && !selectedKey ? topicStates
    .filter(state => state.topicId && state.topicId !== topicId && state.month === month && state.meetingKey)
    .map(state => booked.find(event => event.eventKey === state.meetingKey || event.calendarEventKey === state.meetingKey)).find(Boolean) : undefined;
  const selected = selectedKey ? booked.find(e => e.eventKey === selectedKey || e.calendarEventKey === selectedKey) : shared;
  const topicBooked = Boolean(topicId && selected);
  const aptemPlanItems = aptemPlan.map((review, index) => {
    const event = events.find(e => e.source === 'mcr' && e.reviewSource === 'aptem' && e.reviewId === review.id);
    const booking = booked.find(e => e.source === 'mcr' && e.reviewSource === 'aptem' && e.reviewId === review.id);
    const openSlot = slots.find(item => item.reviewId === review.id);
    const pending = !booking && Boolean(event && occupiesBookingSlot(event));
    const bookingState = booking ? 'booked' : pending ? 'pending' : openSlot ? 'unbooked' : 'unavailable';
    return { review, booking, openSlot, bookingState, number: index + 1 };
  });
  const timelineOpen = dialogKey === TIMELINE_DIALOG_KEY;
  const dialogAptemItem = aptemSourced ? aptemPlanItems.find(item => item.review.id === dialogKey) : undefined;
  const dialogNativeSlot = !aptemSourced ? slots.find(item => item.key === dialogKey) : undefined;
  useEffect(() => {
    if (!dialogKey) return;
    const element = dialogRef.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (!dialogKeyRef.current && dialogTriggerRef.current?.isConnected) dialogTriggerRef.current.focus();
    };
  }, [dialogKey]);
  useEffect(() => {
    if (shared && !selectedKey) latest.current.onSelect(shared.eventKey);
  }, [shared, selectedKey]);
  useEffect(() => {
    let active = true;
    setLoading(true); setTopicStates([]); setBookedHere(''); setChangingMeeting(false); setCalendar(null); setImportedMcms([]); setSlotKey(''); setDialogKey(null); setDate(''); setDuration(60); setError(''); setNotice('');
    Promise.all([
      fetchLearnerCalendarEvents(kind, learnerId, { force: true }),
      fetchReviewHistory(kind, learnerId, 'monthly-coaching'),
      topicId && assignmentId ? loadAssignmentTopicStates({ learnerKind: kind, learnerId, activityId: assignmentId }) : Promise.resolve([]),
    ]).then(([result, history, topics]) => {
      // Without the imported list the right MCM source is unknown: stop rather
      // than offer a Curriculum slot an Aptem learner's coach cannot see.
      if (!Array.isArray(history?.reviews)) throw new Error('Could not load your Monthly Coaching Meetings.');
      if (active) { setCalendar(result); setImportedMcms(history.reviews); setTopicStates(topics); setLoading(false); }
    }).catch(e => { if (active) { setError(e.message || 'Could not load coaching meetings.'); setLoading(false); } });
    return () => { active = false; };
  }, [kind, learnerId, month, assignmentId, topicId, reload]);
  const restriction = () => {
    if (!date) return '';
    const parsed = new Date(`${date}T12:00:00`);
    if (!Number.isFinite(parsed.getTime())) return 'Choose a valid date.';
    if (date < today) return 'Sessions cannot be booked on a date that has already passed.';
    if ([0, 6].includes(parsed.getDay())) return 'Sessions cannot be booked on Saturdays or Sundays.';
    const holiday = calendar?.bookingCalendar?.bankHolidays.find(h => h.date === date);
    if (holiday) return `Sessions cannot be booked on UK bank holidays (${holiday.title}).`;
    if (calendar?.bookingCalendar && !calendar.bookingCalendar.coveredYears.includes(parsed.getFullYear())) return 'The bank-holiday calendar is not available for this year.';
    return '';
  };
  const dateError = restriction();
  const bookingOffset = date ? (12 - Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${date}T12:00:00Z`)))) * 60 : 0;
  useEffect(() => {
    setTime(''); setAvailableTimes([]); setAvailabilityError('');
    if (!date || dateError) { setAvailabilityLoading(false); return; }
    const controller = new AbortController();
    setAvailabilityLoading(true);
    fetchReviewSlots(kind, learnerId, date, duration, { signal: controller.signal })
      .then(times => { if (!controller.signal.aborted) setAvailableTimes(times); })
      .catch(error => { if (!controller.signal.aborted) setAvailabilityError(error.message || 'Could not load coach availability.'); })
      .finally(() => { if (!controller.signal.aborted) setAvailabilityLoading(false); });
    return () => controller.abort();
  }, [date, dateError, bookingOffset, kind, learnerId, duration, reload, availabilityRetry]);
  const book = async () => {
    if (disabled || topicBooked || booking.current || (needsSlot && !slot) || !date || !time || dateError || availabilityLoading || !availableTimes.includes(time)) return;
    booking.current = true; setBusy(true); setError(''); setNotice('');
    const identity = { kind, learnerId, month, assignmentId, topicId };
    try {
      if (!await onSave()) { setError('Save your assignment draft before booking.'); return; }
      if (!mounted.current || Object.keys(identity).some(k => identity[k as keyof typeof identity] !== latest.current[k as keyof typeof identity])) return;
      const result = await bookLearnerCalendarSession(kind, learnerId, {
        sessionType: 'mcr', bookingContext: 'monthly-assignment', eventKey: slot?.eventKey, ...(slot?.reviewId ? { reviewId: slot.reviewId } : {}), assignmentMonth: month, scheduledDate: date, scheduledTime: time,
        durationMinutes: duration, timezoneOffsetMinutes: bookingOffset, notes: `Monthly assignment: ${title}`,
      });
      if (!mounted.current || Object.keys(identity).some(k => identity[k as keyof typeof identity] !== latest.current[k as keyof typeof identity])) return;
      setCalendar(current => current ? { ...current, events: [...current.events.filter(e => e.eventKey !== result.event.eventKey), result.event] } : current);
      setBookedHere(result.event.eventKey);
      latest.current.onSelect(result.event.eventKey); setSlotKey(''); setDialogKey(null); setDate(''); setTime(''); setAvailableTimes([]);
      setNotice(result.warning ? `Booking saved. ${result.warning}` : result.event.invited === false ? 'Booking saved, but the calendar invitation has not been sent. Contact your coach.' : 'Your Monthly Coaching Meeting is booked and linked to this assignment.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not book your meeting.'); }
    finally { booking.current = false; setBusy(false); }
  };
  const input = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm disabled:bg-slate-50';
  const closeDialog = () => { if (!busy) setDialogKey(null); };
  const openTimeline = (trigger: HTMLButtonElement) => {
    dialogTriggerRef.current = trigger;
    setError('');
    setDialogKey(TIMELINE_DIALOG_KEY);
  };
  const openDialog = (key: string, nextSlotKey: string | undefined, trigger: HTMLButtonElement) => {
    if (!timelineOpen) dialogTriggerRef.current = trigger;
    if (nextSlotKey && nextSlotKey !== slotKey) { setSlotKey(nextSlotKey); setDate(''); setTime(''); }
    setError('');
    setDialogKey(key);
  };
  const bookingFields = <div className="space-y-4">
    <p className="text-sm leading-6 text-slate-600">Choose any upcoming weekday throughout the month. Available times come from your coach's calendar and working hours, shown in UK time (Europe/London). Availability is checked again when you book.</p>
    <div className="grid gap-4 sm:grid-cols-2"><BookingDatePicker value={date} onChange={setDate} dates={selectableDates} /><label>Time{<LoadingControl loading={availabilityLoading}><select className={input} value={time} disabled={availabilityLoading || !availableTimes.length} onChange={e => setTime(e.target.value)}><option value="">{availabilityLoading ? 'Loading available times...' : 'Select an available time'}</option>{availableTimes.map(value => <option key={value} value={value}>{value}</option>)}</select></LoadingControl>}</label></div>
    <label className="block">Duration<select className={input} value={duration} onChange={e => { setDuration(Number(e.target.value)); setTime(''); }}>{[30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes === 60 ? '1 hour' : `${minutes} minutes`}</option>)}</select></label>
    {availabilityError && <p role="alert" className="text-sm text-red-700">{availabilityError} <button type="button" onClick={() => setAvailabilityRetry(value => value + 1)} className="underline">Retry availability</button></p>}
    {date && !dateError && !availabilityLoading && !availabilityError && !availableTimes.length && <p className="text-sm text-slate-600">Your coach has no available {duration}-minute appointments on this date. Choose another date or duration.</p>}
    {dateError && <p role="alert" className="text-sm text-red-700">{dateError}</p>}
  </div>;
  const bookButton = <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40" disabled={disabled || busy || topicBooked || (needsSlot && !slot) || !date || !time || Boolean(dateError) || availabilityLoading || !availableTimes.includes(time)} onClick={() => void book()}>{busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{busy ? 'Booking MCM...' : `Book ${duration}-minute MCM`}</button>;
  const meetingTimeline = (slots.length > 0 || aptemSourced) && <div role="group" aria-label="Monthly Coaching Meeting slot" className="w-full">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-primary-600">Your programme journey</p>
                <p className="text-sm font-semibold text-slate-900">Monthly coaching timeline</p></div>
              <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-semibold text-primary-700">{aptemSourced ? `${aptemPlanItems.length} ${aptemPlanItems.length === 1 ? 'meeting' : 'meetings'}` : `${slots.length} available`}</span>
            </div>
            {aptemSourced && <p className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>{aptemPlanItems.filter(item => item.bookingState === 'booked').length} booked</span>
              <span>{aptemPlanItems.filter(item => item.bookingState === 'unbooked').length} not booked</span>
              {aptemPlanItems.some(item => item.bookingState === 'pending' || item.bookingState === 'unavailable') && <span>{aptemPlanItems.filter(item => item.bookingState === 'pending' || item.bookingState === 'unavailable').length} other statuses</span>}
            </p>}
            {aptemSourced && <p className="mb-3 text-[11px] text-slate-500">Review status comes from Aptem. Booking status reflects the confirmed appointment.</p>}
            <div className={`max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 ${aptemSourced ? 'lg:max-h-none lg:overflow-visible' : 'lg:max-h-[33rem]'}`} role="region" aria-label="Monthly Coaching Meetings" tabIndex={0}>
              <ol className={aptemSourced ? 'ml-3 space-y-2 border-l-2 border-slate-200 pb-1 lg:ml-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 lg:border-l-0 2xl:grid-cols-3' : 'ml-3 space-y-2 border-l-2 border-slate-200 pb-1'}>
                {aptemSourced ? aptemPlanItems.map(item => {
                  const bookingLabel = item.bookingState === 'booked' ? 'Booked' : item.bookingState === 'unbooked' ? 'Not booked'
                    : item.bookingState === 'pending' ? 'Booking pending' : 'Not bookable';
                  const reviewLabel = reviewStatusLabels[item.review.status] || item.review.rawStatus || 'Status unavailable';
                  const active = item.review.id === dialogKey || Boolean(item.booking && selected?.eventKey === item.booking.eventKey);
                  return <li key={item.review.id} className="relative pl-5 lg:pl-0">
                    <span aria-hidden="true" className={`absolute -left-[10px] top-4 h-[18px] w-[18px] rounded-full border-[4px] border-white shadow-[0_0_0_2px_#94a3b8] lg:hidden ${item.bookingState === 'booked' ? 'bg-emerald-500' : item.bookingState === 'pending' ? 'bg-amber-400' : 'bg-slate-200'}`} />
                    <button type="button" aria-label={`MCM ${item.number}, ${bookingLabel}, review ${reviewLabel}, planned ${plannedDateLabel(item.review.plannedDate)}`} aria-pressed={active}
                      onClick={event => openDialog(item.review.id, item.openSlot && !topicBooked ? item.openSlot.key : undefined, event.currentTarget)}
                      className={`flex min-h-16 w-full items-start justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${active ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-primary-300 hover:bg-primary-50/50'}`}>
                      <span className="min-w-0 space-y-0.5"><strong className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-900">MCM {item.number}</strong>
                        <span className="block text-[11px] text-slate-600">Review: {reviewLabel}</span>
                        {item.booking && <span className="block text-[11px] text-slate-600">Booked for {plannedDateLabel(item.booking.scheduledDate)}{item.booking.scheduledTime ? ` at ${item.booking.scheduledTime}` : ''}</span>}
                        {item.review.reviewerName && <span className="block text-[11px] text-slate-500">Reviewer: {item.review.reviewerName}</span>}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.bookingState === 'booked' ? 'bg-emerald-100 text-emerald-800' : item.bookingState === 'unbooked' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{bookingLabel}</span>
                        <span className="text-[10px] text-slate-600">Plan {plannedDateLabel(item.review.plannedDate)}</span></span>
                    </button>
                  </li>;
                }) : slots.map(item => {
                  const selected = item.key === dialogKey;
                  return <li key={item.key} className="relative pl-5">
                    <span aria-hidden="true" className={`absolute -left-[10px] top-4 h-[18px] w-[18px] rounded-full border-[4px] border-white shadow-[0_0_0_2px_#94a3b8] ${selected ? 'bg-primary-600 shadow-[0_0_0_2px_#6b9bda]' : 'bg-slate-200'}`} />
                    <button type="button" aria-label={item.label} aria-pressed={selected} onClick={event => openDialog(item.key, item.key, event.currentTarget)}
                      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${selected ? 'border-blue-500 bg-blue-50 text-slate-900 shadow-sm' : 'border-slate-200 bg-white text-slate-800 hover:border-primary-300 hover:bg-primary-50/50'}`}>
                      <span className="min-w-0"><strong className="block text-xs font-bold">{item.label.split(' | ')[0]}</strong>
                        <span className="mt-0.5 block text-[11px] text-slate-600">{selected ? 'Selected' : 'Available to book'} - {item.label.split(' | ')[1]}</span></span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">{plannedDateLabel(item.plannedDate)}</span>
                    </button>
                  </li>;
                })}
              </ol>
            </div>
          </div>;
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <div><h4 className="text-base font-semibold">Arrange your Monthly Coaching Meeting</h4><p className="mt-2 text-sm leading-6 text-slate-600">Use a booked MCM or book a monthly session with your assigned coach below. The same booking appears in your calendar and your coach's calendar.</p></div>
    {loading && <p  className="flex items-center gap-2 text-sm"><LoadingSkeleton label="Loading coaching meetings..." variant="rows" /></p>}
    {!loading && <>
      {(!topicBooked || changingMeeting) && <label className="block">Use an existing coaching booking<select className={input} value={selected?.eventKey || ''} disabled={disabled || busy} onChange={e => { setBookedHere(e.target.value); onSelect(e.target.value); setChangingMeeting(false); }}><option value="">Select a booked meeting</option>{booked.map(e => {
        const aptemNumber = aptemSourced ? aptemPlanItems.find(item => item.booking?.eventKey === e.eventKey)?.number : undefined;
        return <option key={e.eventKey} value={e.eventKey}>{aptemNumber ? `MCM ${aptemNumber} · ` : ''}{e.scheduledDate} {e.scheduledTime} · {e.coachName}</option>;
      })}</select></label>}
      {!disabled && !error && selectedKey && !selected && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">The meeting linked to this draft is no longer available. Choose an existing coaching booking or arrange a new MCM, then run the quality checks again.</p>}
      {!booked.length && !aptemSourced && <p className="text-sm text-slate-500">You have no booked MCM yet.</p>}
      {selected && <div className="rounded-xl bg-blue-50 p-4 text-sm"><p>{topicBooked ? "MCM already booked" : "Linked meeting"}: {selected.scheduledDate} at {selected.scheduledTime} with {selected.coachName}.</p>{topicBooked && <p className="mt-2">You can reuse this booking for the other topics. Changing the linked meeting here keeps earlier submissions unchanged.</p>}{selected.invited === false && <p className="mt-2 text-amber-800">The meeting is saved, but the calendar invitation has not been sent. Contact your coach.</p>}
        {!disabled && <div className="mt-3 flex flex-wrap gap-4">
          {topicBooked && <button type="button" disabled={busy} className="font-medium text-blue-700 underline" onClick={() => setChangingMeeting(current => !current)}>{changingMeeting ? 'Keep linked meeting' : 'Change linked meeting'}</button>}
          {selected.status === 'scheduled' && <Link className="font-medium text-blue-700 underline" to={meetingCalendarHref(selected, { kind, id: learnerId }, 'reschedule')}>Change meeting date or time</Link>}
        </div>}
      </div>}
      {selected && <div className="space-y-3">
        <p className="text-sm leading-6 text-slate-600">Your meeting recording will appear here when it is available after the meeting.</p>
        <CoachMeetingArtifactsPanel event={selected} storedOnly canCheck={false} showAttendance={false} showMeetingSummary={false} visibleArtifactTypes={['recording']} fetchArtifacts={loadArtifacts} contentUrl={contentUrl} />
      </div>}
      {(!topicBooked || aptemSourced) && <fieldset disabled={busy || !calendar || (!aptemSourced && disabled)} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <legend className="px-2 text-sm font-semibold">{aptemSourced ? 'Choose a programme MCM' : 'Schedule an official MCM'}</legend>
          {aptemSourced ? <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary-200 bg-primary-50/60 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary-700">Your programme journey</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">Monthly coaching meetings</p>
              <p className="mt-1 text-xs text-slate-600">{aptemPlanItems.length} meetings / {aptemPlanItems.filter(item => item.bookingState === 'booked').length} booked / {aptemPlanItems.filter(item => item.bookingState === 'unbooked').length} not booked</p>
            </div>
            <button type="button" disabled={busy} onClick={event => openTimeline(event.currentTarget)} className="min-h-11 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 disabled:opacity-50">View programme MCMs</button>
          </div> : meetingTimeline}
        {aptemSourced && !slots.length && !booked.length && <p role="status" className="text-sm text-slate-600">No open Monthly Coaching Meeting is left in your programme plan. Contact your coach to arrange it.</p>}
        {!aptemSourced && !slots.length && <div className="space-y-4">{bookingFields}{bookButton}</div>}
      </fieldset>}
      <button type="button" disabled={busy} className="text-sm font-medium text-blue-700 underline" onClick={() => setReload(n => n + 1)}>Refresh meetings</button>
    </>}
    {notice && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm">{notice}</p>}
    {error && !dialogKey && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {dialogKey && (timelineOpen || dialogAptemItem || dialogNativeSlot) && createPortal(<dialog ref={dialogRef} aria-labelledby={dialogTitleId}
      className={`m-auto max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 ${timelineOpen ? 'max-w-4xl sm:max-h-[85dvh]' : 'max-w-xl'}`}
      onCancel={event => { event.preventDefault(); closeDialog(); }} onClick={event => { if (event.target === event.currentTarget) closeDialog(); }}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-primary-600">Monthly coaching</p>
          <h2 id={dialogTitleId} className="mt-1 text-xl font-semibold">{timelineOpen ? 'Choose a programme MCM' : dialogAptemItem ? `${dialogAptemItem.openSlot && !topicBooked ? 'Book' : 'View'} MCM ${dialogAptemItem.number}` : `Book ${dialogNativeSlot?.label.split(' | ')[0]}`}</h2>
          <p className="mt-1 text-sm text-slate-600">{timelineOpen ? 'Review your meetings and choose one to book or link to this assignment.' : dialogAptemItem?.openSlot && !topicBooked || dialogNativeSlot ? 'Choose a date and time for this programme meeting.' : 'Review this meeting before linking it to your assignment.'}</p>
        </div>
        <button type="button" aria-label={timelineOpen ? 'Close MCM list' : 'Close MCM details'} disabled={busy} onClick={closeDialog} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"><X aria-hidden="true" className="h-4 w-4" /></button>
      </div>
      <div className="space-y-5 px-5 py-5 sm:px-6">
        {timelineOpen && meetingTimeline}
        {dialogAptemItem && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-semibold">Monthly Coaching Meeting · MCM {dialogAptemItem.number}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:text-sm">
            <div><dt className="text-slate-500">Aptem review</dt><dd className="font-medium">{reviewStatusLabels[dialogAptemItem.review.status] || dialogAptemItem.review.rawStatus || 'Status unavailable'}</dd></div>
            <div><dt className="text-slate-500">Booking</dt><dd className="font-medium">{dialogAptemItem.booking ? 'Booked' : dialogAptemItem.bookingState === 'pending' ? 'Booking pending' : dialogAptemItem.openSlot ? 'Not booked' : 'Not bookable'}</dd></div>
            <div><dt className="text-slate-500">Planned date</dt><dd className="font-medium">{plannedDateLabel(dialogAptemItem.review.plannedDate)}</dd></div>
            {dialogAptemItem.review.reviewerName && <div><dt className="text-slate-500">Aptem reviewer</dt><dd className="font-medium">{dialogAptemItem.review.reviewerName}</dd></div>}
            {dialogAptemItem.booking && <div className="col-span-2"><dt className="text-slate-500">Booked appointment</dt><dd className="font-medium">{plannedDateLabel(dialogAptemItem.booking.scheduledDate)}{dialogAptemItem.booking.scheduledTime ? ` at ${dialogAptemItem.booking.scheduledTime} UK time` : ''}</dd></div>}
          </dl>
        </div>}
        {dialogNativeSlot && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Session to book</p><p className="mt-1 font-semibold">{dialogNativeSlot.label.split(' | ')[0]}</p><p className="mt-1 text-xs text-slate-600">Planned for {plannedDateLabel(dialogNativeSlot.plannedDate)}</p></div>}
        {dialogAptemItem?.booking && <p className="text-sm text-slate-600">This appointment is already booked. Linking it to this assignment does not create another meeting.</p>}
        {dialogAptemItem?.bookingState === 'pending' && <p className="text-sm text-amber-800">This booking is being confirmed. Refresh the meetings before linking it to your assignment.</p>}
        {dialogAptemItem?.bookingState === 'unavailable' && <p className="text-sm text-slate-600">This Aptem review cannot be booked from the assignment.</p>}
        {dialogAptemItem?.openSlot && topicBooked && <p className="text-sm text-slate-600">This assignment already has a linked MCM. You can select another booked MCM from the timeline.</p>}
        {(dialogNativeSlot || (dialogAptemItem?.openSlot && !topicBooked)) && <fieldset disabled={disabled || busy || !calendar} className="space-y-4">{bookingFields}</fieldset>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
        {dialogAptemItem && <button type="button" disabled={busy} onClick={() => { setError(''); setDialogKey(TIMELINE_DIALOG_KEY); }} className="min-h-11 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to meetings</button>}
        <button type="button" disabled={busy} onClick={closeDialog} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Close</button>
        {dialogAptemItem?.booking && !disabled && <button type="button" disabled={busy || selected?.eventKey === dialogAptemItem.booking.eventKey} onClick={() => { setBookedHere(dialogAptemItem.booking!.eventKey); onSelect(dialogAptemItem.booking!.eventKey); setChangingMeeting(false); setDialogKey(null); }} className="min-h-11 flex-1 rounded-xl bg-primary-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{selected?.eventKey === dialogAptemItem.booking.eventKey ? 'Already linked' : 'Use this MCM'}</button>}
        {(dialogNativeSlot || (dialogAptemItem?.openSlot && !topicBooked)) && bookButton}
      </div>
    </dialog>, document.body)}
  </section>;
}
