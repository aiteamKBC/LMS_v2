import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarCheck2, CalendarDays, CheckCircle2, ExternalLink, Send } from 'lucide-react';
import styles from '../coach-booking/booking.module.css';
import { SYSTEM_TIME_ZONE } from '@/lib/format';
import { getLmsIntroduction, getLmsIntroductionTimes, LmsIntroductionError, requestLmsIntroduction, slotLabel, type LmsIntroductionState } from '@/api/lmsIntroduction';

// Shared by the date, time and note controls.
const CONTROL = 'w-full rounded-[10px] border border-auth-input-border bg-auth-surface p-[11px_13px] text-[14px] font-normal text-auth-input-text focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-auth-focus';
const FIELD = 'grid gap-[7px] text-[13px] font-[650] text-auth-ink';
const HINT = 'm-0 text-[12px] leading-[1.6] text-auth-hint';
const ERROR = 'm-0 rounded-[10px] border border-auth-error-border bg-auth-error-bg p-[12px_14px] text-[13px] text-auth-error-text';

// Today in the business time zone, as the YYYY-MM-DD a date input expects.
const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function LmsIntroductionPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const [state, setState] = useState<LmsIntroductionState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [freeTimes, setFreeTimes] = useState<string[] | null>(null);
  const [timesLoading, setTimesLoading] = useState(false);
  const [timesError, setTimesError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setState(null);
    getLmsIntroduction(token, controller.signal).then(found => {
      setState(found);
      setDate(found.request?.date ?? ''); setTime(found.request?.time ?? ''); setNote(found.request?.note ?? '');
    }).catch(reason => { if (!controller.signal.aborted) setLoadError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, reload]);

  // Only the times the case owner is actually free are offered for a day.
  const booked = state?.request?.status === 'scheduled';
  useEffect(() => {
    setFreeTimes(null); setTimesError('');
    if (!state || booked || !date) return;
    const controller = new AbortController();
    setTimesLoading(true);
    getLmsIntroductionTimes(token, date, controller.signal).then(found => {
      setFreeTimes(found.times);
      setTime(current => (found.times.includes(current) ? current : ''));
    }).catch(reason => { if (!controller.signal.aborted) setTimesError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setTimesLoading(false); });
    return () => controller.abort();
  }, [token, date, state, booked]);

  const send = (body: { date: string; time: string; note: string }) => {
    if (saving) return;
    setSaving(true); setSaveError('');
    requestLmsIntroduction(token, body).then(setState)
      .catch(reason => {
        setSaveError(reason.message);
        // Already booked: show the booking instead of the form.
        if (reason instanceof LmsIntroductionError && reason.state) setState(reason.state);
      })
      .finally(() => setSaving(false));
  };
  const submit = (event: FormEvent) => { event.preventDefault(); send({ date, time, note }); };

  const request = state?.request;
  const owner = state?.caseOwner || 'your case owner';
  const legacyRequest = request?.status === 'requested';
  return <main className={styles.page}>
    <div className={styles.container}>
      <div className={styles.brandBar}><img src="/assets/kbc-logo.png" alt="Kent Business College" width="175" height="80" /><span><CalendarDays size={17} aria-hidden="true" />LMS introduction</span></div>
      <header className={styles.hero}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}>WELCOME TO THE PLATFORM</p><h1>{state ? `Book your LMS introduction with ${owner}` : 'Book your LMS introduction'}</h1><p>A short one-to-one meeting on Microsoft Teams where your case owner shows you around the learning platform. Choose a time when they are free and the Teams invitation is sent to your email straight away.</p><span className={styles.accessNote}><CheckCircle2 size={16} aria-hidden="true" />No password needed to book</span></div>
        <div className={styles.heroIcon} aria-hidden="true"><CalendarCheck2 strokeWidth={1.3} /></div>
      </header>
      {loading && <p role="status" className={styles.message}>Loading your booking...</p>}
      {loadError && <div role="alert" className={styles.message}>{loadError}<button type="button" className={styles.retry} onClick={() => setReload(value => value + 1)}>Retry</button></div>}
      {state && <section className={styles.booking} aria-label="LMS introduction booking">
        {request && booked ? <div className={styles.empty}>
          <span className={styles.emptyIcon}>{request.inviteSent ? <CalendarCheck2 size={30} aria-hidden="true" /> : <AlertTriangle size={30} aria-hidden="true" />}</span>
          <h2>{request.inviteSent ? 'Your LMS introduction is booked' : 'Your booking is saved'}</h2>
          <p className="mx-0 mb-0 mt-3.5 text-[15px] font-[650] text-auth-ink">{slotLabel(request.date, request.time)}</p>
          {request.inviteSent
            ? <p>It is in {owner}'s Teams calendar, and the Microsoft Teams invitation has been sent to your email. To change it, reply to that invitation or contact {owner}.</p>
            : <>
              <p role="alert" className={ERROR}>{state.warning || 'The Microsoft Teams invitation has not been sent yet.'}</p>
              <p><button type="button" className="cursor-pointer rounded-xl border border-auth-secondary-border bg-auth-surface p-[12px_18px] text-[14px] font-semibold text-auth-secondary-text max-[560px]:w-full max-[560px]:justify-center" disabled={saving} onClick={() => send({ date: request.date ?? '', time: request.time ?? '', note: request.note })}>{saving ? 'Sending...' : 'Send the Teams invitation again'}</button></p>
            </>}
          {request.meetingLink && <p><a className={styles.openBooking} href={request.meetingLink} target="_blank" rel="noopener noreferrer">Open the Teams meeting<ExternalLink size={17} aria-hidden="true" /></a></p>}
          {saveError && <p role="alert" className={ERROR}>{saveError}</p>}
        </div> : <form className="grid gap-[18px] p-6 max-[560px]:p-5" onSubmit={submit}>
          <div className={styles.sectionHeading}><span className={styles.stepNumber}>01</span><div><h2>Choose a time</h2><p>{state.durationMinutes} minutes with {owner} on Microsoft Teams, Monday to Friday. Times are UK time.</p></div></div>
          {legacyRequest && <p className={HINT}>You asked for {slotLabel(request?.date ?? null, request?.time ?? null)}. Choose a time below to book it now.</p>}
          <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
            <label className={FIELD}>Date<input className={CONTROL} type="date" required min={businessToday()} value={date} onChange={event => setDate(event.target.value)} /></label>
            <label className={FIELD}>Start time<select className={CONTROL} required value={time} disabled={!freeTimes || freeTimes.length === 0} onChange={event => setTime(event.target.value)}>
              <option value="">{!date ? 'Choose a date first' : timesLoading ? 'Checking availability...' : freeTimes && freeTimes.length === 0 ? 'No free times this day' : 'Choose a time'}</option>
              {(freeTimes ?? []).map(option => <option key={option} value={option}>{option}</option>)}
            </select></label>
          </div>
          {timesError && <p role="alert" className={ERROR}>{timesError}</p>}
          {freeTimes && freeTimes.length === 0 && !timesError && <p className={HINT}>{owner} has no free times on this day. Please choose another date.</p>}
          <label className={FIELD}>Anything your case owner should know? (optional)<textarea className={`${CONTROL} min-h-24 resize-y`} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
          <p className={HINT}>Only times when {owner} is free are shown. Weekends and UK bank holidays are not available. Your email address is shared with {owner} for the Teams invitation.</p>
          {saveError && <p role="alert" className={ERROR}>{saveError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="inline-flex cursor-pointer items-center gap-2.5 rounded-xl border-0 bg-auth-action p-[13px_20px] text-[14px] font-[650] text-white enabled:hover:bg-auth-action-hover disabled:cursor-not-allowed disabled:opacity-60 max-[560px]:w-full max-[560px]:justify-center" disabled={saving || !date || !time}><Send size={17} aria-hidden="true" />{saving ? 'Booking...' : 'Book this time'}</button>
          </div>
        </form>}
      </section>}
      <footer className={styles.footer}><span>Kent Business College</span><span>Learning support, one conversation at a time.</span></footer>
    </div>
  </main>;
}
