import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { DashboardMeetingActions } from '@/pages/workspace/coach/DashboardMeetingActions';
import {
  eventDisplayDate,
  eventIdentity,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isCompletedEvent,
  meetingUrl,
  parseLocalDate,
  sortEvents,
  statusLabel,
  type CoachCalendarEvent,
} from '../shared/calendarEvents';
import styles from './meetings.module.css';

const coachNav = roleNavMap.coach;

function mondayOf(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function isoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekFromQuery(value: string | null) {
  const parsed = parseLocalDate(value);
  return mondayOf(parsed || new Date());
}

function eventDate(event: CoachCalendarEvent) {
  return parseLocalDate(eventDisplayDate(event));
}

function isMeetingEvent(event: CoachCalendarEvent) {
  return event.source === 'mcr' || event.source === 'progress-review';
}

function meetingType(event: CoachCalendarEvent) {
  return event.source === 'progress-review' ? 'Progress Review' : 'Monthly Coaching Meeting';
}

function weekLabel(start: Date, end: Date) {
  const startText = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: start.getMonth() === end.getMonth() ? undefined : 'short' }).format(start);
  const endText = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(end);
  return `${startText} – ${endText}`;
}

function statusTone(status: CoachCalendarEvent['status']) {
  if (status === 'completed' || status === 'confirmed') return 'positive';
  if (status === 'scheduled' || status === 'in-progress') return 'brand';
  if (status === 'pending' || status === 'not-scheduled') return 'warning';
  return 'neutral';
}

function updateEvent(events: CoachCalendarEvent[], updated: CoachCalendarEvent) {
  const key = eventIdentity(updated);
  return sortEvents(events.map(event => eventIdentity(event) === key ? updated : event));
}

export default function CoachMeetings() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [weekStart, setWeekStart] = useState(() => weekFromQuery(params.get('week')));
  const [search, setSearch] = useState(() => params.get('q') || '');
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const next = new URLSearchParams();
    if (isoDate(weekStart) !== isoDate(mondayOf(new Date()))) next.set('week', isoDate(weekStart));
    if (search.trim()) next.set('q', search.trim());
    setParams(next, { replace: true });
  }, [search, setParams, weekStart]);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setEvents([]);
      setOwnerName(coach.name);
      setError('Coach access is required to load meetings.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchCoachCalendarEvents(controller.signal)
      .then(data => {
        setEvents(sortEvents((data.events || []).filter(isMeetingEvent)));
        setOwnerName(data.owner?.name || coach.name);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load meetings.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [coach.email, coach.isInitialized, coach.name]);

  const weekEnd = addDays(weekStart, 6);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;
    return events.filter(event => [event.learner, event.email, event.programme, event.group, event.cohort, meetingType(event)]
      .filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [events, search]);
  const thisWeek = filtered.filter(event => {
    const date = eventDate(event);
    return date && date >= weekStart && date <= weekEnd && !isCompletedEvent(event);
  });
  const upcoming = filtered.filter(event => {
    const date = eventDate(event);
    return date && date > weekEnd && !isCompletedEvent(event);
  }).slice(0, 10);

  const applyUpdate = (updated: CoachCalendarEvent) => setEvents(current => updateEvent(current, updated));
  const openLearner = (event: CoachCalendarEvent) => navigate('/coach/learner-case-file', { state: {
    learnerId: event.learnerId, learnerName: event.learner, kind: event.learnerType, enrolmentId: event.enrolmentId,
  } });
  const openCalendar = (event?: CoachCalendarEvent) => navigate('/coach/timetable', event ? { state: { focusEvent: {
    eventKey: eventIdentity(event), source: event.source, date: eventDisplayDate(event), title: event.title, scheduledTime: event.scheduledTime,
  } } } : undefined);
  const bookMeeting = () => navigate('/coach/timetable', { state: { scheduleIntent: { source: 'mcr' } } });

  const rows = (items: CoachCalendarEvent[], fullActions: boolean) => items.map(event => <tr key={eventIdentity(event)}>
    <td>{formatDateLabel(eventDisplayDate(event))}</td>
    <td>{formatTimeLabel(event)}</td>
    <td><strong className={styles.learnerName}>{event.learner || 'Unknown learner'}</strong><small className={styles.cellSub}>{event.programme || event.group || event.cohort || 'Programme not recorded'}</small></td>
    <td>{meetingType(event)}</td>
    <td><span className={styles.status} data-tone={statusTone(event.status)}><AppIcon name={event.status === 'confirmed' ? 'ri-checkbox-circle-fill' : 'ri-calendar-event-line'} />{statusLabel(event.status)}</span></td>
    {fullActions ? <DashboardMeetingActions event={event} onUpdated={applyUpdate} onScheduleNotice={setNotice} /> : <td>
      <button type="button" className={styles.outlineButton} onClick={() => openCalendar(event)}><AppIcon name="ri-calendar-line" />{meetingUrl(event) ? 'View in calendar' : 'Book Meeting'}</button>
    </td>}
    <td><button type="button" className={styles.outlineButton} onClick={() => openLearner(event)}>View Learner</button></td>
  </tr>);

  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Meetings" pageSubtitle="Schedule, track, and manage learner sessions" userName={ownerName} userRole="Progress Coach">
    <main className={styles.page}>
      <header className={styles.title}><h1>Meetings</h1><p>Schedule, track, and manage learner sessions.</p></header>
      {error ? <EmptyState variant="error" title="Unable to load meetings." description={error} /> : null}
      {notice ? <div className={styles.notice} role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss message"><AppIcon name="ri-close-line" /></button></div> : null}

      <section className={styles.panel} aria-labelledby="week-schedule-title">
        <header className={styles.panelHeader}>
          <div className={styles.panelHeading}><span className={styles.headingIcon}><AppIcon name="ri-calendar-line" /></span><div><h2 id="week-schedule-title">This Week's Schedule</h2><p>Meetings scheduled with learners this week.</p></div></div>
          <div className={styles.headerActions}>
            <div className={styles.weekControl}><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><AppIcon name="ri-arrow-left-s-line" /></button><span><AppIcon name="ri-calendar-line" />{weekLabel(weekStart, weekEnd)}</span><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><AppIcon name="ri-arrow-right-s-line" /></button></div>
            <button type="button" className={styles.outlineButton} onClick={() => openCalendar()}>View full calendar<AppIcon name="ri-arrow-right-s-line" /></button>
            <button type="button" className={styles.primaryButton} onClick={bookMeeting}><AppIcon name="ri-calendar-add-line" />Book Meeting with Learner</button>
          </div>
        </header>
        <div className={styles.searchRow}><label><AppIcon name="ri-search-line" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search learners or meeting types..." /></label><button type="button" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</button></div>
        <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Meetings scheduled for {weekLabel(weekStart, weekEnd)}</caption><thead><tr><th>Date</th><th>Time</th><th>Learner Name</th><th>Meeting Type</th><th>Status</th><th>Reschedule</th><th>Send Reminder</th><th>Generate Presentation</th><th>View Form</th><th>Action</th></tr></thead><tbody>{rows(thisWeek, true)}</tbody></table></div>
        {loading ? <div className={styles.state}><RowsSkeleton rows={5} /></div> : null}
        {!loading && !error && thisWeek.length === 0 ? <EmptyState variant="empty" icon="ri-calendar-check-line" title="No meetings in this week." description="Use the arrows to review another week or book a learner meeting." /> : null}
      </section>

      <section className={styles.panel} aria-labelledby="upcoming-title">
        <header className={styles.panelHeader}><div className={styles.panelHeading}><span className={styles.headingIcon}><AppIcon name="ri-calendar-line" /></span><div><h2 id="upcoming-title">Upcoming Meetings</h2><p>Your scheduled meetings after this week.</p></div></div><button type="button" className={styles.outlineButton} onClick={() => openCalendar()}>View all meetings<AppIcon name="ri-arrow-right-s-line" /></button></header>
        <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Upcoming learner meetings</caption><thead><tr><th>Date</th><th>Time</th><th>Learner Name</th><th>Meeting Type</th><th>Status</th><th>Calendar</th><th>Action</th></tr></thead><tbody>{rows(upcoming, false)}</tbody></table></div>
        {!loading && !error && upcoming.length === 0 ? <EmptyState variant="empty" icon="ri-calendar-event-line" title="No upcoming meetings." /> : null}
      </section>
    </main>
  </WorkspaceShell>;
}
