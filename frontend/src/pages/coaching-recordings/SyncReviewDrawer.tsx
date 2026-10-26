import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, X } from 'lucide-react';
import type { CoachingCalendar } from '@/api/coachingRecordings';
import { calendarErrorLabel, initialChecksPending } from './model';

interface Props {
  data: CoachingCalendar; issues: CoachingCalendar['errors']; bookings: CoachingCalendar['lmsOnly'];
  pending: boolean; busy: boolean; coachName: (email: string) => string; learnerName: (id: string) => string;
  updatesPaused?: boolean;
  onClose: () => void; onRefresh: () => void; onViewCoach: (email: string) => void;
}
const action = 'rounded-lg border border-background-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:opacity-50';

export default function SyncReviewDrawer({ data, issues, bookings, pending, busy, updatesPaused = false, coachName, learnerName, onClose, onRefresh, onViewCoach }: Props) {
  const titleId = useId(), panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const contain = (event: FocusEvent) => { if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) closeButton.current?.focus(); };
    document.addEventListener('keydown', keydown); document.addEventListener('focusin', contain);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', contain); document.body.style.overflow = previous; if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const when = (stamp: string) => new Intl.DateTimeFormat('en-GB', { timeZone: data.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stamp));
  const calendarPending = pending || Boolean(data.sync?.pendingCalendars);
  const preparing = initialChecksPending(data.sync);
  return createPortal(<div className="fixed inset-0 z-50 bg-black/40" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-background-200 bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-background-200 p-5">
        <div><h2 id={titleId} className="text-base font-bold">Sync & booking details</h2><p className="mt-1 text-xs text-foreground-500">Calendar availability and LMS booking comparison</p></div>
        <button ref={closeButton} type="button" aria-label="Close sync details" className="rounded-md p-1.5 text-foreground-500 hover:bg-background-100" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 scrollbar-slim">
        <section aria-label="Calendar availability" className="rounded-xl border border-background-200 p-4">
          <h3 className="text-sm font-semibold">{data.coverage.checkedCoachEmails.length} of {data.coverage.totalCoaches} calendars loaded</h3>
          {updatesPaused && <p className="mt-2 text-xs text-foreground-600">Automatic page updates have stopped. Saved results remain available; use Recheck calendars to request another update.</p>}
          <p className="mt-2 text-xs text-foreground-600">{data.partial ? 'Some checks need attention. The available meetings remain usable.' : pending || preparing ? 'Initial calendar checks are still pending. The available meetings remain usable.' : 'The latest available calendar results are loaded.'}</p>
          {preparing && <p className="mt-2 text-xs text-foreground-500">First checks remaining: {data.sync?.initialPendingCalendars ?? data.sync?.pendingCalendars} calendars and {data.sync?.initialPendingEvidence ?? data.sync?.pendingEvidence} meetings.</p>}
          {data.sync?.pending && !preparing && <p className="mt-2 text-xs text-foreground-500">Saved results are available. Scheduled background checks keep them up to date; you can use the calendar now.</p>}
          {data.sync?.lastSuccessfulAt && <p className="mt-2 text-xs text-foreground-500">Last successful calendar check: {when(data.sync.lastSuccessfulAt)}</p>}
        </section>
        <section aria-label="Checks needing attention">
          <h3 className="text-sm font-semibold">Checks needing attention <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">{issues.length}</span></h3>
          {data.partial && !issues.length && <p className="mt-2 text-xs text-foreground-600">Some results are incomplete. Recheck calendars to retrieve the latest status.</p>}
          {!data.partial && !issues.length && <p className="mt-2 text-xs text-foreground-500">No calendar or recording check errors in this snapshot.</p>}
          <ul className="mt-3 space-y-3">{issues.map(item => <li key={`${item.coachEmail}:${item.code}`} className="rounded-xl border border-background-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{item.coachEmail ? coachName(item.coachEmail) : 'Calendar check'}</p>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${item.retryable === false ? 'bg-amber-50 text-amber-900' : 'bg-background-100 text-foreground-600'}`}>{item.retryable === false ? 'Account action required' : 'Temporary check failure'}</span></div>
            <p className="mt-2 text-xs leading-5 text-foreground-600">{calendarErrorLabel(item.code)}</p>
            {item.coachEmail && <button type="button" className={`${action} mt-3`} onClick={() => onViewCoach(item.coachEmail)} aria-label={`View calendar for ${coachName(item.coachEmail)}`}>View coach calendar</button>}
          </li>)}</ul>
          {issues.some(item => item.retryable === false) && <p className="mt-3 text-xs leading-5 text-foreground-500">Account failures pause automatic retries for up to 24 hours. After correcting the saved account, mailbox or app access, recheck calendars.</p>}
        </section>
        <section aria-label="LMS booking comparison">
          <h3 className="text-sm font-semibold">LMS booking comparison <span className="ml-1 rounded-full bg-background-100 px-2 py-0.5 text-xs">{bookings.length}</span></h3>
          <p className="mt-2 text-xs leading-5 text-foreground-600">These saved LMS bookings have no confirmed calendar match in the loaded snapshot. This does not establish cancellation or absence.</p>
          {(calendarPending || data.partial) && <p role="status" className="mt-3 rounded-lg bg-primary-50 p-3 text-xs text-primary-800">Calendar comparison is incomplete or still updating. These results are provisional.</p>}
          {!bookings.length && <p className="mt-3 text-xs text-foreground-500">No unmatched LMS bookings in the loaded results.</p>}
          <ul className="mt-3 divide-y divide-background-100">{bookings.map(row => <li key={`${row.coachEmail}:${row.eventKey}`} className="py-3">
            <p className="text-sm font-semibold">{learnerName(row.learnerId)}</p><p className="mt-1 text-xs text-foreground-600">{coachName(row.coachEmail)} · {when(row.startsAt)}</p>
          </li>)}</ul>
        </section>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-background-200 p-4"><p className="text-xs text-foreground-500">Times in {data.timeZone}</p><button type="button" className={`${action} inline-flex items-center gap-2`} disabled={busy} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" />Recheck calendars</button></footer>
    </aside>
  </div>, document.body);
}
