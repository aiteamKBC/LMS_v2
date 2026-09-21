import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  bookLearnerCalendarSession,
  fetchLearnerFirstSession,
  rescheduleLearnerCalendarSession,
  type LearnerFirstSession,
} from '@/api/learnerCalendar';
import type { LearnerKind } from '@/api/learnerDetail';
import { SessionTimeColumns, slotLabel } from './SessionTimeColumns';
import { RouteLoadingSkeleton } from './RouteLoadingSkeleton';

// ============================================================================
// The learner's first session is their own first task.
//
// It used to be arranged by whoever enrolled them, on the create form. Now the
// learner signs in, books it with their case owner, and waits until the day —
// so nothing about their programme opens before the session that starts it.
//
// Two states, both decided by the server (`access`), never by this browser: a
// learner must not reach their programme early by changing their own clock.
//
//   'book'    -> the booking screen below
//   'waiting' -> the holding screen below
//   'open'    -> nothing; the programme renders normally
//
// Note this is NOT the cohort start-date lockout that LearnerProgrammeGate
// used to apply and that was deliberately removed. That held learners out of
// modules they had already been assigned. This is the one meeting that has to
// happen before there is a programme to be let into at all.
// ============================================================================

/** Paths a held learner can still reach. Support and their own profile stay
 *  open: somebody who cannot book, or who thinks the date is wrong, needs a
 *  way to say so that is not "email an address they do not have". */
const ALWAYS_OPEN = ['/messages', '/learner/messages', '/learner/support', '/profile'];

const exempt = (path: string) =>
  ALWAYS_OPEN.some(base => path === base || path.startsWith(`${base}/`));

/** Tomorrow in UK time — the earliest a first session can be booked.
 *
 *  The server refuses a past date anyway (booking_date_restriction); this just
 *  stops the date field offering one. */
function earliestBookable(): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(day);
}

/** The UK offset for a given day, in JavaScript's own sign convention
 *  (UTC minus local), which is what the backend reads.
 *
 *  Pinned to Europe/London rather than the browser's zone: the session happens
 *  in Kent whatever the learner's own clock says. */
function ukOffsetFor(date: string): number {
  return (12 - Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(`${date}T12:00:00Z`)))) * 60;
}

function longDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function FirstSessionGate({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const account = auth.account;
  // Only the learner's own session holds them up. Staff and admins carry a
  // different role and never reach this; an account that is both a staff
  // member and a learner (login/learner_enrolment.py) is gated on their own
  // record and nowhere else, which the role check already gives us because
  // reviewing somebody else's page is done from a staff-role session.
  if (account?.role !== 'learner') return <>{children}</>;
  return <LearnerFirstSessionGate key={account.subjectId}>{children}</LearnerFirstSessionGate>;
}

function LearnerFirstSessionGate({ children }: { children: ReactNode }) {
  const { auth, logout } = useAuth();
  const { pathname } = useLocation();
  const account = auth.account;
  const kind = account?.learnerType || 'apprenticeship';
  const learnerId = String(account?.subjectId ?? '');

  const [state, setState] = useState<LearnerFirstSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    return fetchLearnerFirstSession(kind, learnerId, signal)
      .then(result => { if (!signal?.aborted) setState(result); })
      .catch((err: Error) => {
        if (signal?.aborted) return;
        setLoadError(err.message || 'Could not check your first session.');
      })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [kind, learnerId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (exempt(pathname)) return <>{children}</>;
  if (loading && !state) return <RouteLoadingSkeleton />;

  // A gate that cannot reach the server must not become a lockout: the learner
  // has done nothing wrong, and holding them out on a network error would be
  // the same screen as holding them out on purpose.
  if (loadError && !state) return <>{children}</>;
  if (!state || state.access === 'open') return <>{children}</>;

  return (
    <Holding
      state={state}
      kind={kind}
      learnerId={learnerId}
      onBooked={() => void load()}
      onSignOut={logout}
    />
  );
}

function Holding({ state, kind, learnerId, onBooked, onSignOut }: {
  state: LearnerFirstSession;
  kind: LearnerKind;
  learnerId: string;
  onBooked: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-background-200 px-4 py-10">
      <div className="mx-auto max-w-xl rounded-2xl border border-foreground-200 bg-background-50 p-6 sm:p-8">
        {state.access === 'waiting'
          ? <Waiting state={state} kind={kind} learnerId={learnerId} onChanged={onBooked} />
          : <Booking state={state} kind={kind} learnerId={learnerId} onBooked={onBooked} />}
        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-foreground-100 pt-4 text-[13px]">
          <a href="/learner/support" className="text-primary-600 hover:underline">Contact support</a>
          <button type="button" onClick={onSignOut} className="text-foreground-500 hover:underline">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Waiting({ state, kind, learnerId, onChanged }: {
  state: LearnerFirstSession;
  kind: LearnerKind;
  learnerId: string;
  onChanged: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const time = (state.event?.scheduledTime || '').slice(0, 5);

  if (moving) {
    return (
      <Reschedule
        state={state}
        kind={kind}
        learnerId={learnerId}
        onDone={() => { setMoving(false); onChanged(); }}
        onCancel={() => setMoving(false)}
      />
    );
  }

  return (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-600">
        You are all set
      </span>
      <h1 className="mt-2 text-xl font-semibold text-foreground-900">
        Your programme starts on {state.startsOn ? longDate(state.startsOn) : 'your first session'}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-foreground-600">
        Your first session with{' '}
        <span className="font-semibold text-foreground-800">
          {state.caseOwner?.name || 'your case owner'}
        </span>
        {time ? <> is at <span className="font-semibold text-foreground-800">{slotLabel(time)}</span> UK time</> : null}.
        Your learning opens here on the day — there is nothing else to do until then.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {state.event?.meetingLink && (
          <a
            href={state.event.meetingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-600"
          >
            <i className="ri-vidicon-line" aria-hidden="true" />
            Join the Teams meeting
          </a>
        )}
        <button
          type="button"
          onClick={() => setMoving(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-background-100 px-4 py-2.5 text-[13px] font-semibold text-foreground-700 hover:bg-background-200"
        >
          <i className="ri-calendar-event-line" aria-hidden="true" />
          Reschedule
        </button>
      </div>
      <p className="mt-4 text-[12px] text-foreground-400">
        The invitation is in your email. Moving the session moves the day your
        programme starts.
      </p>
    </>
  );
}

/** Move a session the learner has already booked.
 *
 *  The same endpoint the enrolment officer uses from the learner's record, so
 *  the existing Teams meeting is moved and both people are re-invited rather
 *  than a second meeting appearing. */
function Reschedule({ state, kind, learnerId, onDone, onCancel }: {
  state: LearnerFirstSession;
  kind: LearnerKind;
  learnerId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(state.startsOn || '');
  const [time, setTime] = useState((state.event?.scheduledTime || '').slice(0, 5) || '09:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const eventKey = state.event?.eventKey || '';
  const unchanged = date === state.startsOn
    && time === (state.event?.scheduledTime || '').slice(0, 5);

  const move = async () => {
    if (saving || !date || !time || unchanged || !eventKey) return;
    setSaving(true);
    setError('');
    try {
      await rescheduleLearnerCalendarSession(kind, learnerId, {
        eventKey,
        scheduledDate: date,
        scheduledTime: time,
        durationMinutes: state.event?.durationMinutes || 60,
        timezoneOffsetMinutes: ukOffsetFor(date),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move your session. Please try again.');
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-foreground-900">Move your first session</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-foreground-600">
        Pick a new day and time with{' '}
        <span className="font-semibold text-foreground-800">
          {state.caseOwner?.name || 'your case owner'}
        </span>
        . The existing Teams meeting moves and you will both be re-invited.
      </p>

      <div className="mt-5 flex flex-wrap items-start gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
            Date
          </span>
          <input
            type="date"
            value={date}
            min={earliestBookable()}
            disabled={saving}
            onChange={event => { setDate(event.target.value); setError(''); }}
            className="rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-[13px] font-medium text-foreground-900 outline-none focus:border-primary-400 disabled:opacity-60"
          />
          <span className="text-[11px] text-foreground-400">
            Weekdays only — not weekends or UK bank holidays.
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span id="reschedule-time-label" className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
            Time (UK)
          </span>
          <SessionTimeColumns
            value={time}
            onChange={next => { setTime(next); setError(''); }}
            labelledBy="reschedule-time-label"
            disabled={saving}
          />
        </div>
      </div>

      {time && (
        <p className="mt-2 text-[12px] text-foreground-500">
          New time <span className="font-semibold">{slotLabel(time)}</span> UK time.
        </p>
      )}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void move()}
          disabled={saving || unchanged || !date || !time}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <i className={saving ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} aria-hidden="true" />
          {saving ? 'Moving…' : 'Move my session'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl px-4 py-2.5 text-[13px] font-medium text-foreground-600 hover:bg-background-100 disabled:opacity-60"
        >
          Keep it as it is
        </button>
      </div>

      {error && <p role="alert" className="mt-3 text-[13px] text-red-700">{error}</p>}
    </>
  );
}

function Booking({ state, kind, learnerId, onBooked }: {
  state: LearnerFirstSession;
  kind: LearnerKind;
  learnerId: string;
  onBooked: () => void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const owner = state.caseOwner;

  // Without a case owner there is nobody to meet. The learner cannot fix that
  // themselves, so this says who can rather than showing a form that will fail.
  if (!owner) {
    return (
      <>
        <h1 className="text-xl font-semibold text-foreground-900">
          Your first session cannot be booked yet
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-foreground-600">
          You do not have a case owner assigned, so there is nobody to book your first
          session with. Please contact support and we will get this sorted.
        </p>
      </>
    );
  }

  const book = async () => {
    if (saving || !date || !time) return;
    setSaving(true);
    setError('');
    try {
      await bookLearnerCalendarSession(kind, learnerId, {
        sessionType: 'first-session',
        scheduledDate: date,
        scheduledTime: time,
        durationMinutes: 60,
        timezoneOffsetMinutes: ukOffsetFor(date),
      });
      onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book your session. Please try again.');
      setSaving(false);
    }
  };

  return (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-600">
        Welcome
      </span>
      <h1 className="mt-2 text-xl font-semibold text-foreground-900">
        Book your first learning session
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-foreground-600">
        Before your programme starts, book a one-hour session with your case owner,{' '}
        <span className="font-semibold text-foreground-800">{owner.name}</span>. Your
        learning opens on the day of that session.
      </p>

      <div className="mt-5 flex flex-wrap items-start gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
            Date
          </span>
          <input
            type="date"
            value={date}
            min={earliestBookable()}
            disabled={saving}
            onChange={event => { setDate(event.target.value); setError(''); }}
            className="rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-[13px] font-medium text-foreground-900 outline-none focus:border-primary-400 disabled:opacity-60"
          />
          <span className="text-[11px] text-foreground-400">
            Weekdays only — not weekends or UK bank holidays.
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span id="first-session-time-label" className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
            Time (UK)
          </span>
          <SessionTimeColumns
            value={time}
            onChange={next => { setTime(next); setError(''); }}
            labelledBy="first-session-time-label"
            disabled={saving}
          />
        </div>
      </div>

      {time && (
        <p className="mt-2 text-[12px] text-foreground-500">
          Session at <span className="font-semibold">{slotLabel(time)}</span> UK time.
        </p>
      )}

      <button
        type="button"
        onClick={() => void book()}
        disabled={saving || !date || !time}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <i className={saving ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} aria-hidden="true" />
        {saving ? 'Booking…' : 'Book my first session'}
      </button>

      {error && <p role="alert" className="mt-3 text-[13px] text-red-700">{error}</p>}
    </>
  );
}
