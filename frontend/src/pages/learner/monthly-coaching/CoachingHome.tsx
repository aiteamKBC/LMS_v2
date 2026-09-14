import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, Clock3, ExternalLink, FileText, List, PenLine, UserRound, Video } from 'lucide-react';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { meetingBookingWarning, meetingCalendarHref } from '../reviews/meetingBooking';
import { coachingOverview, type CoachingGroup, type CoachingReviewDefinitions, type CoachingSessionState } from './coachingOverview';
import styles from './coachingHome.module.css';

export interface CoachingHomeProps {
  sessions: LearnerCalendarEvent[];
  attendance: MeetingAttendance[];
  reviews?: CoachingReviewDefinitions;
  currentCoach?: { name: string; email: string } | null;
  learner: { kind: string; id: string };
  today: string;
  timeZone?: string;
  loading: boolean;
  error: string;
  canAct: boolean;
  busy: boolean;
  onSchedule: (session: LearnerCalendarEvent) => void;
  onAttend: (id: string) => void;
  onReport: (session: MeetingAttendance) => void;
}

const tabs: { id: CoachingGroup; label: string }[] = [
  { id: 'needs-action', label: 'Needs your action' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' },
];
const dateLabel = (date: string | null, short = false) => date
  ? new Intl.DateTimeFormat('en-GB', { ...(short ? {} : { weekday: 'short' as const }), day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  : 'Date to be confirmed';
const monthLabel = (date: string | null) => date ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : 'Monthly coaching';
const titleOf = (state: CoachingSessionState) => state.session.importedReview?.name || (state.date ? `${monthLabel(state.date)} coaching` : 'Monthly coaching');
const timeLabel = (state: CoachingSessionState) => {
  const time = state.attendance ? state.attendance.startTime : state.session.scheduledTime;
  return state.booked && time ? time.slice(0, 5) : 'Time to be confirmed';
};

export default function CoachingHome(props: CoachingHomeProps) {
  const { sessions, attendance, reviews, learner, today, loading, error } = props;
  const overview = useMemo(() => coachingOverview(sessions, attendance, today, reviews), [sessions, attendance, today, reviews]);
  const [params, setParams] = useSearchParams();
  const allView = params.get('view') === 'all';
  const tab = tabs.find(item => item.id === params.get('tab'))?.id || 'upcoming';
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const groups = { 'needs-action': overview.needsAction, upcoming: overview.upcoming, past: overview.past };
  const rows = groups[tab];
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const currentPage = Math.min(page, pages);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(allView);
  useEffect(() => {
    if (previousView.current !== allView) heading.current?.focus();
    previousView.current = allView;
  }, [allView]);
  const linkToView = (all: boolean, selected?: CoachingGroup) => {
    const next = new URLSearchParams({ kind: learner.kind, learner: learner.id });
    if (all) { next.set('view', 'all'); if (selected) next.set('tab', selected); }
    return `/learner/monthly-coaching?${next}`;
  };
  const changeTab = (value: CoachingGroup) => {
    const next = new URLSearchParams(params);
    next.set('kind', learner.kind); next.set('learner', learner.id);
    next.set('view', 'all'); next.set('tab', value); next.delete('page'); setParams(next);
  };
  const detailHref = (state: CoachingSessionState) => {
    const next = new URLSearchParams({ kind: learner.kind, learner: learner.id });
    if (allView) { next.set('view', 'all'); next.set('tab', tab); next.set('page', String(currentPage)); }
    return `/learner/monthly-coaching/${encodeURIComponent(state.session.id)}?${next}`;
  };
  const otherActions = overview.needsAction.filter(item => item.session.id !== overview.current?.session.id);
  const lastMeeting = overview.past.find(item => item.date && item.date <= today && item.statusLabel !== 'Cancelled');
  const current = overview.current;
  const assignedCoach = props.currentCoach;
  const currentCoachName = assignedCoach?.name.trim() || (assignedCoach ? 'Not yet assigned' : 'To be confirmed');
  const bookedHost = current?.booked ? current.session.coachName.trim() : '';
  const hostDiffers = Boolean(bookedHost && (!assignedCoach
    || (assignedCoach.email && current?.session.coachEmail
      ? assignedCoach.email.toLowerCase() !== current.session.coachEmail.toLowerCase()
      : assignedCoach.name.trim().toLowerCase() !== bookedHost.toLowerCase())));
  const duration = current?.attendance ? current.attendance.durationMinutes : current?.session.durationMinutes;
  const provider = current?.attendance ? current.attendance.meetingProvider : current?.session.meetingProvider;
  const currentCaption = current?.action === 'sign' ? 'YOUR NEXT STEP'
    : current?.action === 'reschedule' ? 'REARRANGE YOUR MEETING'
      : current?.isToday ? "TODAY'S MEETING" : current?.booked ? 'YOUR NEXT MEETING' : 'PLAN YOUR MEETING';
  const dateCaption = current?.action === 'sign' ? 'Meeting summary ready to review'
    : current?.booked ? timeLabel(current) : current?.action === 'schedule' ? 'Planned date - a time has not been booked' : 'Check the meeting details below';

  function renderAction(state: CoachingSessionState, secondary = false) {
    const className = secondary ? styles.secondaryButton : styles.primaryButton;
    if (state.action === 'schedule' || state.action === 'reschedule') return <button type="button" className={className}
      disabled={!props.canAct || props.busy} onClick={() => props.onSchedule(state.session)}><CalendarDays size={17}/>{state.actionLabel}<ArrowRight size={17}/></button>;
    if (state.action === 'join' && state.joinUrl) return <a className={className} href={state.joinUrl} target="_blank" rel="noopener noreferrer"><Video size={18}/>Join meeting<ArrowRight size={17}/></a>;
    return <Link className={className} to={detailHref(state)}>{state.action === 'sign' ? <PenLine size={17}/> : <FileText size={17}/>}
      {state.action === 'sign' && !props.canAct ? 'View summary' : state.actionLabel}<ArrowRight size={17}/></Link>;
  }

  function renderStatus(state: CoachingSessionState) {
    return <span className={styles.badge} data-tone={state.needsAction ? 'attention' : state.group === 'past' ? 'muted' : state.isToday ? 'today' : 'booked'}>{state.isToday && <span className={styles.statusDot}/>} {state.statusLabel}</span>;
  }

  function renderMeetingLink(state: CoachingSessionState) {
    if (!state.joinUrl || state.action === 'join') return null;
    return <a className={styles.meetingLink} href={state.joinUrl} target="_blank" rel="noopener noreferrer">
      <Video size={17}/>Open meeting link<ExternalLink size={15}/>
    </a>;
  }

  function renderOptions(state: CoachingSessionState) {
    const status = (state.attendance?.status || state.session.status).trim().toLowerCase().replace(/[ _]+/g, '-');
    const canReschedule = state.booked && status === 'scheduled' && !state.attendance?.attendanceConfirmed && state.action !== 'reschedule';
    return <details className={styles.options}>
      <summary>More options<ChevronDown size={16}/></summary>
      <div className={styles.optionPanel}>
        <Link to={detailHref(state)}><FileText size={16}/>View meeting</Link>
        {canReschedule && <button type="button" disabled={!props.canAct || props.busy} onClick={() => props.onSchedule(state.session)}><CalendarDays size={16}/>Reschedule</button>}
        {state.attendance?.canReportAbsence && !state.attendance.absenceReported && !state.attendance.attendanceConfirmed && <button type="button"
          disabled={!props.canAct || props.busy} onClick={() => props.onReport(state.attendance!)}>Report absence</button>}
        {(!state.session.importedReview || state.attendance?.calendarEventKey) && <Link to={meetingCalendarHref(state.session, learner, undefined, state.attendance)}><CalendarDays size={16}/>View in calendar</Link>}
      </div>
    </details>;
  }

  return <section className={styles.home} aria-label="Monthly Coaching Meetings">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>YOUR LEARNING, TOGETHER</p><h1 ref={heading} tabIndex={-1}>{allView ? 'All coaching meetings' : 'My coaching'}</h1>
        <p className={styles.intro}>{allView ? 'Find a meeting, check its status or revisit a summary.' : 'Your next meeting and anything that needs your attention.'}</p></div>
      <div className={styles.headerLinks}>{allView ? <><Link className={styles.secondaryButton} to={linkToView(false)}><ArrowLeft size={17}/>Back to current meeting</Link>
        <Link className={styles.textLink} to={`/learner/calendar?kind=${learner.kind}&learner=${learner.id}`}><CalendarDays size={16}/>Open calendar</Link></>
        : <Link className={styles.secondaryButton} to={linkToView(true)}><List size={18}/>View all meetings<ArrowRight size={17}/></Link>}</div>
    </header>
    {loading && !sessions.length ? <div className={styles.skeleton} role="status" aria-label="Loading coaching meetings"><span/><span/><span/></div>
      : error && !sessions.length ? <div className={styles.empty}><CalendarDays/><h2>Your meetings could not be loaded</h2><p>Use Try again above to reload your meetings.</p></div>
      : allView ? <section className={styles.archive} aria-label="All coaching meetings">
        <div className={styles.tabs} role="tablist" aria-label="Coaching meeting status">{tabs.map((item, index) => <button type="button" role="tab" id={`coaching-tab-${item.id}`} aria-controls="coaching-meetings-panel"
          key={item.id} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => changeTab(item.id)}
          onKeyDown={event => { const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); changeTab(tabs[next].id); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); } }}>
          {item.label}<span>{groups[item.id].length}</span></button>)}</div>
        <div role="tabpanel" id="coaching-meetings-panel" aria-labelledby={`coaching-tab-${tab}`} tabIndex={0}>
          <p className={styles.archiveHint}>{tab === 'upcoming' ? 'Booked appointments and future meetings in your programme plan.' : tab === 'past' ? 'Previous meetings, saved summaries and records waiting for an update.' : 'Only meetings with a next step for you.'}</p>
          {!rows.length ? <div className={styles.empty}><CheckCheck/><h2>{tab === 'needs-action' ? 'Nothing needs your action' : tab === 'past' ? 'No past meetings yet' : 'No upcoming meetings'}</h2><p>{tab === 'needs-action' ? 'You can check your next appointment in Upcoming.' : 'Your meetings will appear here when they are available.'}</p></div>
            : <ul className={styles.meetingList}>{rows.slice((currentPage - 1) * 8, currentPage * 8).map(state => <li key={state.session.id}>
              <div className={styles.listDate}><CalendarDays size={19}/><span>{dateLabel(state.date, true)}</span></div>
              <div className={styles.listIdentity}><Link aria-label="View meeting" to={detailHref(state)}>{titleOf(state)}</Link><p>{state.session.coachName || 'Coach to be confirmed'}{state.booked && <> · {timeLabel(state)}</>}</p><p className={styles.listDescription}>{state.description}</p></div>
              <div className={styles.listAction}>{renderStatus(state)}{renderAction(state, true)}{renderMeetingLink(state)}{renderOptions(state)}</div>
            </li>)}</ul>}
        </div>
        {rows.length > 8 && <nav className={styles.pagination} aria-label="Meeting pages"><span>Page {currentPage} of {pages} · {rows.length} meetings</span><div>{[-1, 1].map(direction => <button type="button" key={direction} disabled={direction < 0 ? currentPage === 1 : currentPage === pages} onClick={() => {
          const next = new URLSearchParams(params); next.set('page', String(currentPage + direction)); setParams(next);
        }}>{direction < 0 ? <><ArrowLeft size={16}/>Previous</> : <>Next<ArrowRight size={16}/></>}</button>)}</div></nav>}
      </section> : <>
        {!!otherActions.length && <section className={styles.attention} aria-label="Needs your attention"><div className={styles.sectionHeading}><div><span className={styles.attentionIcon}><PenLine size={17}/></span><h2>Needs your attention <span>{otherActions.length}</span></h2></div>
          {otherActions.length > 2 && <Link to={linkToView(true, 'needs-action')}>View all actions<ArrowRight size={16}/></Link>}</div>
          {otherActions.slice(0, 2).map(state => <article key={state.session.id} className={styles.attentionRow}><div><h3>{state.statusLabel}</h3><p>{dateLabel(state.date)} · {state.session.coachName || 'Your coach'}</p><p>{state.description}</p></div>{renderAction(state, true)}</article>)}
        </section>}
        <div className={styles.currentLayout}>
          {overview.current ? <article className={styles.current} aria-label="Current coaching meeting">
            <div className={styles.currentTop}><p className={styles.eyebrow}>{currentCaption}</p>{renderStatus(overview.current)}</div>
            <h2>{titleOf(overview.current)}</h2>
            <div className={styles.appointment}><span className={styles.dateIcon}><CalendarDays size={28}/></span><div><p>{dateLabel(overview.current.date)}</p><span>{dateCaption}</span>
              {overview.current.booked && <span className={styles.timeZone}>{props.timeZone || 'Europe/London'}{duration != null && duration > 0 && <> · {duration} minutes</>}</span>}</div></div>
            <div className={styles.coach}><span><UserRound size={20}/></span><div><small>Your current coach</small><strong>{currentCoachName}</strong>
              {hostDiffers && <p className={styles.bookedHost}>This meeting is booked with {bookedHost}.</p>}</div>
              {overview.current.booked && <span className={styles.provider}><Video size={17}/>{provider || 'Location to be confirmed'}</span>}</div>
            <p className={styles.nextStep}>{overview.current.description}</p>
            {meetingBookingWarning(overview.current.session, overview.current.attendance?.syncWarning) && <div className={styles.warning} role="status"><strong>Calendar sync pending</strong><p>{meetingBookingWarning(overview.current.session, overview.current.attendance?.syncWarning)}</p></div>}
            <div className={styles.currentActions}>{renderAction(overview.current)}{renderMeetingLink(overview.current)}{renderOptions(overview.current)}</div>
            {overview.current.booked && !overview.current.joinUrl && <p className={styles.linkUnavailable}>Meeting link is not available yet.</p>}
            {overview.current.attendance?.canAttend && !overview.current.attendance.attendanceConfirmed && !overview.current.attendance.absenceReported && <div className={styles.attendanceConfirm}><p>Already attended this meeting?</p><button type="button" disabled={!props.canAct || props.busy} onClick={() => props.onAttend(overview.current!.attendance!.id)}><Check size={16}/>{props.busy ? 'Saving…' : 'Confirm attendance'}</button></div>}
          </article> : <article className={`${styles.current} ${styles.empty}`} aria-label="Current coaching meeting"><span className={styles.emptyIcon}><CheckCheck size={30}/></span><h2>No current meeting</h2><p>Your next appointment will appear here. You can still open your previous meeting records.</p><Link className={styles.secondaryButton} to={linkToView(true)}>View your meetings<ArrowRight size={17}/></Link></article>}
          <aside className={styles.sideColumn} aria-label="Meeting preparation"><section className={styles.preparation}><span className={styles.preparationIcon}><FileText size={22}/></span><h2>A little preparation helps</h2><p>Bring a few notes to make the most of your time together.</p><ol><li><span>1</span><div><strong>Your progress</strong><p>What have you learned or put into practice?</p></div></li><li><span>2</span><div><strong>Anything you need help with</strong><p>Bring your questions or challenges.</p></div></li><li><span>3</span><div><strong>Your next steps</strong><p>Think about what you want to work on next.</p></div></li></ol></section>
            {lastMeeting && <section className={styles.lastMeeting}><p className={styles.eyebrow}>LAST MEETING</p><h3>{dateLabel(lastMeeting.date, true)}</h3><p>{lastMeeting.statusLabel}</p><Link to={detailHref(lastMeeting)}>View meeting summary<ArrowRight size={16}/></Link></section>}
          </aside>
        </div>
        <p className={styles.footerNote}><Clock3 size={15}/>Looking for another month?<Link to={linkToView(true)}>Browse all {overview.all.length} meetings<ArrowRight size={15}/></Link></p>
      </>}
  </section>;
}
