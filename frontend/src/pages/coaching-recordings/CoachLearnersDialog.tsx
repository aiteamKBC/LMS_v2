import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadCoachLearners, type CoachLearners, type CoachingMeeting } from '@/api/coachingRecordings';
import { formatFullDate } from '@/pages/curriculum/recordings/utils';
import { meetingPhase, categoryLabels } from './model';

interface Props {
  coachEmail: string;
  coachName: string;
  start: string;
  end: string;
  timeZone: string;
  meetings: CoachingMeeting[];
  calendarPartial: boolean;
  onClose: () => void;
  onViewMeetings: (learnerId: string) => void;
}

const button = 'rounded-lg border border-background-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:opacity-50';
const statusLabels: Record<string, string> = { 'not-scheduled': 'Not scheduled', scheduled: 'Scheduled', 'in-progress': 'In progress',
  'awaiting-signature': 'Awaiting signature', completed: 'Completed', cancelled: 'Cancelled' };
const typeLabels: Record<string, string> = { mcr: categoryLabels.MCM, 'progress-review': categoryLabels.PR, 'student-support': categoryLabels.SUPPORT, 'catch-up': 'Catch-up' };

export default function CoachLearnersDialog({ coachEmail, coachName, start, end, timeZone, meetings, calendarPartial, onClose, onViewMeetings }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const controllerRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<CoachLearners | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current!;
    document.body.style.overflow = 'hidden';
    dialog.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (!dialog.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'))
        .sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', handleKey);
    return () => {
      dialog.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller;
    setLoading(true); setError(''); setData(null); setExpanded(null);
    void loadCoachLearners({ coachEmail, start, end, timeZone, search }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Coach learners could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controllerRef.current?.abort();
  }, [coachEmail, start, end, timeZone, search, revision]);

  const loadMore = async () => {
    if (!data || data.coverage.nextOffset === null || loading) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setLoading(true); setError('');
    try {
      const next = await loadCoachLearners({ coachEmail, start, end, timeZone, search, offset: data.coverage.nextOffset }, controller.signal);
      if (controller.signal.aborted) return;
      const ids = new Set(data.learners.map(row => row.id));
      if (next.scope !== data.scope || next.coverage.totalLearners !== data.coverage.totalLearners || next.learners.some(row => ids.has(row.id))) {
        throw new Error('The learner list changed. Refresh learners to load the current caseload.');
      }
      setData({ ...next, learners: [...data.learners, ...next.learners] });
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof Error && reason.name === 'CoachingLearnersAccessError') setData(null);
        setError(reason instanceof Error ? reason.message : 'More learners could not be loaded.');
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const dateTime = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const unlinked = meetings.filter(row => !row.learnerIds.length).length;

  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground-950/40 p-3 backdrop-blur-sm sm:p-6"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white text-foreground-900 shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)]">
      <div className="shrink-0 border-b border-background-200 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">
          <h2 id={titleId} className="break-words text-xl font-bold">{coachName} — learners</h2>
          <p className="mt-1 text-xs text-foreground-600">{formatFullDate(start)} – {formatFullDate(end)} · {timeZone}</p>
        </div><button type="button" className={button} aria-label="Close coach learners" onClick={onClose}>Close</button></div>
        <p className="mt-3 text-sm text-foreground-600">Current learners, saved LMS bookings and review status in the selected period. Calendar meetings retain their original titles.</p>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setRevision(value => value + 1); }}>
          <input aria-label="Search coach learners" className="w-full min-w-0 flex-none rounded-lg border border-background-200 px-3 py-2 text-sm sm:w-auto sm:flex-1" value={draft} maxLength={100} placeholder="Learner name" onChange={event => setDraft(event.target.value)} />
          <button type="submit" className={button} disabled={loading}>Search learners</button>
          <button type="button" className={button} disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh learners</button>
        </form>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-5">
        {calendarPartial && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Some calendar meetings could not be loaded. The saved LMS bookings below are a separate source.</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error} <button type="button" className="font-semibold underline" onClick={() => setRevision(value => value + 1)}>Retry learners</button></p>}
        {loading && <p role="status" className="text-sm">Loading coach learners…</p>}
        {data && <>
          <p role="status" className="text-xs text-foreground-600">Showing {data.learners.length} of {data.coverage.totalLearners} learners{search ? ` matching “${search}”` : ''}.</p>
          {!data.learners.length && <p className="py-4 text-sm text-foreground-600">No current learners match this search.</p>}
          {data.learners.map(learner => {
            const calendar = meetings.filter(row => row.learnerIds.includes(learner.id));
            const open = expanded === learner.id;
            return <section key={learner.id} aria-label={`Learner ${learner.name}`} className="rounded-xl border border-background-200 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0">
                <h3 className="break-words font-semibold">{learner.name}</h3>
                <p className="mt-1 text-xs text-foreground-500">{learner.learnerType || 'Learner'} · {learner.bookings.length} saved LMS entries · {calendar.length} calendar meetings</p>
              </div><div className="flex flex-wrap gap-2">
                <button type="button" className={button} aria-expanded={open} onClick={() => setExpanded(open ? null : learner.id)}>Bookings &amp; review status</button>
                <button type="button" className={button} onClick={() => onViewMeetings(learner.id)}>View learner meetings</button>
              </div></div>
              {open && <div className="mt-4 space-y-4 border-t border-background-100 pt-3">
                <div><h4 className="text-sm font-semibold">Saved LMS bookings and reviews</h4>
                  {!learner.bookings.length && <p className="mt-2 text-sm text-foreground-600">No saved LMS bookings or reviews in this period. This does not establish whether a meeting was booked elsewhere.</p>}
                  <ul className="mt-2 space-y-3">{learner.bookings.map(booking => {
                    const linked = calendar.find(row => row.eventKey === booking.eventKey);
                    return <li key={booking.eventKey} className="rounded-lg bg-background-50 p-3 text-sm">
                      <p className="break-words font-semibold">{linked?.title || `${typeLabels[booking.eventType] || booking.eventType} #${booking.sequence}`}</p>
                      <p className="mt-1">LMS status: {statusLabels[booking.status] || booking.status || 'Unknown'}{booking.cancelled ? ' · LMS cancellation recorded' : ''}</p>
                      <p className="mt-1 text-xs text-foreground-600">{booking.startsAt ? `Scheduled: ${dateTime(booking.startsAt)}` : booking.scheduledDate ? `Scheduled date: ${formatFullDate(booking.scheduledDate)} · Time not recorded` : `Not scheduled${booking.targetDate ? ` · Target date: ${formatFullDate(booking.targetDate)}` : ''}`}</p>
                      {booking.reviewCompletedAt && <p className="mt-1 text-xs text-foreground-600">Review completed at: {dateTime(booking.reviewCompletedAt)}</p>}
                      {booking.periodBasis === 'record-updated' && <p className="mt-1 text-xs text-amber-800">Included by record update date{booking.recordUpdatedAt ? `: ${dateTime(booking.recordUpdatedAt)}` : ''}. The original meeting or cancellation time was not retained.</p>}
                      {booking.syncState && <p className="mt-1 text-xs text-foreground-600">Microsoft sync: {booking.syncState}</p>}
                    </li>;
                  })}</ul>
                </div>
                <div><h4 className="text-sm font-semibold">Microsoft calendar meetings</h4>
                  {!calendar.length && <p className="mt-2 text-sm text-foreground-600">No linked calendar meetings loaded for this learner in the selected period.</p>}
                  <ul className="mt-2 space-y-2">{calendar.map(row => <li key={`${row.coachEmail}:${row.calendarEventId}`} className="rounded-lg bg-primary-50 p-3 text-sm">
                    <p className="break-words font-semibold">{row.title || 'Untitled meeting'}</p>
                    <p className="mt-1 text-xs">{dateTime(row.startsAt)} · {meetingPhase(row, Date.now())}{row.eventKey ? '' : ' · No confirmed LMS booking link'}</p>
                  </li>)}</ul>
                </div>
              </div>}
            </section>;
          })}
          {data.coverage.nextOffset !== null && <button type="button" className={button} disabled={loading} onClick={() => void loadMore()}>Load more learners</button>}
        </>}
        {unlinked > 0 && <p className="text-xs text-foreground-600">{unlinked} calendar meetings have no learner linked and remain visible in the coach calendar.</p>}
      </div>
    </div>
  </div>, document.body);
}
