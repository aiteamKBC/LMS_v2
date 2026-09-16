import { useEffect, useId, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, FileText, List, Video } from 'lucide-react';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import MeetingAttendanceActions from '../reviews/MeetingAttendanceActions';
import { meetingBookingWarning, meetingCalendarHref } from '../reviews/meetingBooking';
import { reviewOverview, reviewsListHref, type ReviewDefinitions, type ReviewFilter, type ReviewPresentation } from './reviewPresentation';
import styles from './reviewsHome.module.css';

export interface ReviewsHomeProps {
  sessions: LearnerCalendarEvent[];
  attendance: MeetingAttendance[];
  definitions?: ReviewDefinitions;
  learner: { kind: string; id: string };
  lineManager?: string | null;
  today: string;
  timeZone?: string;
  loading: boolean;
  error: string;
  busy: boolean;
  canAct: boolean;
  titleOf: (session: LearnerCalendarEvent) => string;
  onSchedule: (session: LearnerCalendarEvent) => void;
  onAttend: (id: string) => void;
  onReport: (session: MeetingAttendance) => void;
}

const filters: { id: ReviewFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }];
const dateLabel = (value: string | null) => {
  if (!value) return 'Date to be confirmed';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date) : 'Date to be confirmed';
};

export default function ReviewsHome(props: ReviewsHomeProps) {
  const { sessions, attendance, definitions, learner, today, titleOf } = props;
  const overview = useMemo(() => reviewOverview(sessions, attendance, today, definitions), [sessions, attendance, today, definitions]);
  const [params, setParams] = useSearchParams();
  const allView = params.get('view') === 'all';
  const filter = filters.find(item => item.id === params.get('filter'))?.id || 'all';
  const rows = overview[filter];
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const page = Math.min(pages, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1));
  const heading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(allView);
  useEffect(() => {
    if (previousView.current !== allView) heading.current?.focus();
    previousView.current = allView;
  }, [allView]);
  const viewHref = (all: boolean) => reviewsListHref(learner, new URLSearchParams(all ? 'view=all' : ''));
  const detailHref = (state: ReviewPresentation) => {
    const next = new URLSearchParams(reviewsListHref(learner, params).split('?')[1]);
    if (allView) { next.set('filter', filter); next.set('page', String(page)); }
    return `/learner/progress-reviews/${encodeURIComponent(state.session.id)}?${next}`;
  };
  const updateView = (selected: ReviewFilter, selectedPage = 1) => {
    const next = new URLSearchParams({ kind: learner.kind, learner: learner.id, view: 'all', filter: selected });
    if (selectedPage > 1) next.set('page', String(selectedPage));
    setParams(next);
  };
  const current = overview.current;
  const reminders = overview.attention.filter(item => item.session.id !== current?.session.id);
  const attentionId = useId();

  function status(state: ReviewPresentation) {
    return <span className={styles.badge} data-tone={state.needsAttention ? 'attention' : state.status === 'completed' ? 'success' : 'neutral'}>{state.label}</span>;
  }
  function action(state: ReviewPresentation, secondary = false) {
    const className = secondary ? styles.secondaryButton : styles.primaryButton;
    if (state.action === 'schedule') return <button type="button" className={className} disabled={!props.canAct || props.busy} onClick={() => props.onSchedule(state.session)}><CalendarDays size={19} aria-hidden="true"/>Book a time</button>;
    if (state.action === 'join' && state.joinUrl) return <a className={className} href={state.joinUrl} target="_blank" rel="noopener noreferrer"><Video size={19} aria-hidden="true"/>Join meeting</a>;
    return <Link className={className} to={detailHref(state)}><FileText size={19} aria-hidden="true"/>{state.action === 'sign' && props.canAct ? 'Read & sign' : 'View review'}</Link>;
  }
  function canUseAttendanceActions(state: ReviewPresentation) {
    return !state.session.importedReview && !['completed', 'cancelled', 'awaiting-signature'].includes(state.status);
  }
  function options(state: ReviewPresentation) {
    if (state.session.importedReview && !state.attendance?.calendarEventKey) return null;
    const showAttendanceOptions = canUseAttendanceActions(state) && state.attendance && !state.attendance.canAttend && !state.attendance.absenceReported
      && !state.attendance.attendanceConfirmed && (state.attendance.canReportAbsence || state.attendance.missed);
    return <details className={styles.options}><summary>More options<ChevronDown size={18} aria-hidden="true"/></summary><div className={styles.optionItems}>
      {state.action === 'join' ? <Link to={detailHref(state)}>View review details</Link> : null}
      {state.canReschedule && !state.attendance?.missed && <button type="button" disabled={!props.canAct || props.busy} onClick={() => props.onSchedule(state.session)}>Reschedule meeting</button>}
      {state.joinUrl && state.action !== 'join' && <a href={state.joinUrl} target="_blank" rel="noopener noreferrer">Open meeting link</a>}
      {(!state.session.importedReview || state.attendance?.calendarEventKey) && <Link to={meetingCalendarHref(state.session, learner, undefined, state.attendance)}>View in calendar</Link>}
      {showAttendanceOptions && <MeetingAttendanceActions session={state.attendance} busy={props.busy} canAct={props.canAct}
        onAttend={() => props.onAttend(state.attendance!.id)} onReport={() => props.onReport(state.attendance!)} onReschedule={() => props.onSchedule(state.session)}/>}
    </div></details>;
  }
  function attendanceActions(state: ReviewPresentation) {
    if (!canUseAttendanceActions(state)) return null;
    if (!state.attendance?.canAttend && !state.attendance?.attendanceConfirmed && !state.attendance?.absenceReported) return null;
    return <div className={styles.attendance}>
      {state.attendance.canAttend && !state.attendance.attendanceConfirmed && !state.attendance.absenceReported && <p>Attended this meeting? Record your attendance separately from joining the call.</p>}
      <MeetingAttendanceActions session={state.attendance} featured={state.attendance.canAttend} busy={props.busy} canAct={props.canAct}
        onAttend={() => props.onAttend(state.attendance!.id)} onReport={() => props.onReport(state.attendance!)} onReschedule={() => props.onSchedule(state.session)}/>
    </div>;
  }
  function warning(state: ReviewPresentation) {
    const message = meetingBookingWarning(state.session, state.attendance?.syncWarning);
    return message ? <p className={styles.notice} role="status">{message}</p> : null;
  }

  return <section className={styles.home} aria-label="Reviews sessions">
    <header className={styles.header}><div><h1 ref={heading} tabIndex={-1}>{allView ? 'All reviews' : 'My reviews'}</h1><p className={styles.intro}>{allView ? 'Find a review, check its status or read a previous record.' : 'Your next review and anything that needs your attention.'}</p></div>
      <div className={styles.headerLinks}>{allView ? <Link className={styles.secondaryButton} to={viewHref(false)}><ArrowLeft size={19} aria-hidden="true"/>Back to current review</Link> : <Link className={styles.secondaryButton} to={viewHref(true)}><List size={19} aria-hidden="true"/>View all reviews ({sessions.length})</Link>}</div>
    </header>
    {props.loading && !sessions.length ? <div className={styles.loading} role="status">Loading your reviews…</div>
      : props.error && !sessions.length ? <div className={styles.empty}><h2>Your reviews could not be loaded</h2><p>Use Try again above to reload your reviews.</p></div>
      : <>
        {props.loading && <p role="status" className={styles.refreshStatus}>Updating your reviews…</p>}
        {allView ? <section className={styles.archive} aria-label="All reviews">
          <div className={styles.filters} role="group" aria-label="Filter reviews">{filters.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => updateView(item.id)}>{item.label} ({overview[item.id].length})</button>)}</div>
          {!rows.length ? <div className={styles.empty}><h2>{filter === 'past' ? 'No past reviews yet' : filter === 'upcoming' ? 'No upcoming reviews' : 'No reviews yet'}</h2><p>Your reviews will appear here when they are available.</p></div> : <ul className={styles.reviewList}>
            {rows.slice((page - 1) * 8, page * 8).map(state => <li key={state.session.id} className={styles.reviewRow}>
              <div className={styles.rowIdentity}><h2><Link to={detailHref(state)}>{titleOf(state.session)}</Link></h2><p>{state.session.coachName || 'Reviewer to be confirmed'}</p><p>{state.description}</p></div>
              <div className={styles.rowDate}>{status(state)}<p>{state.action === 'schedule' ? 'Target date' : state.booked ? 'Meeting date' : 'Review date'}</p><strong>{dateLabel(state.date)}</strong>{state.booked && <p>{state.attendance?.startTime || state.session.scheduledTime || 'Time to be confirmed'}{props.timeZone ? ` · ${props.timeZone}` : ''}</p>}</div>
              <div className={styles.rowActions}>{action(state, true)}{options(state)}{attendanceActions(state)}</div>{warning(state)}
            </li>)}
          </ul>}
          {pages > 1 && <nav className={styles.pagination} aria-label="Review pages"><span>Page {page} of {pages}</span><div><button type="button" disabled={page === 1} onClick={() => updateView(filter, page - 1)}><ArrowLeft size={17} aria-hidden="true"/>Previous</button><button type="button" disabled={page === pages} onClick={() => updateView(filter, page + 1)}>Next<ArrowRight size={17} aria-hidden="true"/></button></div></nav>}
        </section> : <>
          {reminders.length > 0 && <p className={styles.refreshStatus}><a className={styles.textLink} href={`#${attentionId}`}>{reminders.length} {reminders.length === 1 ? 'review needs' : 'reviews need'} your attention<ArrowRight size={17} aria-hidden="true"/></a></p>}
          {current ? <article className={styles.current} aria-label="Current review">
            <div className={styles.currentTop}><p className={styles.eyebrow}>{current.isToday ? "Today's review" : current.action === 'sign' || current.past ? 'Your next step' : 'Your next review'}</p>{status(current)}</div>
            <h2 className={styles.title}>{titleOf(current.session)}</h2>
            <div className={styles.appointment}><span className={styles.appointmentIcon}><CalendarDays size={28} aria-hidden="true"/></span><div><p className={styles.dateLabel}>{dateLabel(current.date)}</p><p className={styles.timeLabel}>{current.action === 'schedule' ? 'Target date — a meeting time has not been booked' : current.booked ? `${current.attendance?.startTime || current.session.scheduledTime || 'Time to be confirmed'}${props.timeZone ? ` · ${props.timeZone}` : ''}` : 'Review record'}</p></div></div>
            <div className={styles.meta}><div><small>Reviewer / Coach</small><strong>{current.session.coachName || 'Not assigned yet'}</strong></div>{props.lineManager && <div><small>Line manager</small><strong>{props.lineManager}</strong></div>}{current.booked && <div><small>Meeting</small><strong>{current.attendance?.meetingProvider || current.session.meetingProvider || 'Location to be confirmed'}{(current.attendance?.durationMinutes ?? current.session.durationMinutes) > 0 ? ` · ${current.attendance?.durationMinutes ?? current.session.durationMinutes} minutes` : ''}</strong></div>}</div>
            <p className={styles.help}>{current.description}</p>{warning(current)}
            <div className={styles.actions}>{action(current)}{current.action === 'schedule' && <Link className={styles.textLink} to={detailHref(current)}>View review details<ArrowRight size={17} aria-hidden="true"/></Link>}{options(current)}</div>
            {attendanceActions(current)}
          </article> : <article className={styles.empty} aria-label="Current review"><h2>No current review</h2><p>Your next review will appear here when it is planned. You can still open your previous records.</p><Link className={styles.secondaryButton} to={viewHref(true)}>View all reviews<ArrowRight size={18} aria-hidden="true"/></Link></article>}
          {reminders.length > 0 && <section id={attentionId} className={styles.attention} aria-label="Reviews needing attention"><h2 className={styles.attentionHeading}>Also needs your attention ({reminders.length})</h2>{reminders.map(state => <article key={state.session.id} className={styles.attentionItem}><div><h3>{titleOf(state.session)}</h3><p>{state.label} · {dateLabel(state.date)}</p><p>{state.description}</p></div>{action(state, true)}</article>)}</section>}
        </>}
        <footer className={styles.footer}><Link className={styles.textLink} to={`/learner/calendar?${new URLSearchParams({ kind: learner.kind, learner: learner.id })}`}><CalendarDays size={18} aria-hidden="true"/>Open calendar</Link></footer>
      </>}
  </section>;
}
