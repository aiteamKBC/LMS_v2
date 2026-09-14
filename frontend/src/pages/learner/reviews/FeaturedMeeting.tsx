import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { LearnerDetail } from '@/api/learnerDetail';
import { AppIcon } from '@/components/feature/AppIcon';
import { featuredSession, meetingIsBooked, meetingJoinUrl, meetingTimeRange } from './featuredSession';
import styles from './featuredMeeting.module.css';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import MeetingAttendanceActions from './MeetingAttendanceActions';
import { meetingBookingWarning } from './meetingBooking';

export default function FeaturedMeeting({ sessions, source, learner, learnerQuery, today, loading, error, onSchedule, titleOf, attendance, timeZone, busy, canAct, onAttend, onReport }: {
  sessions: LearnerCalendarEvent[]; source: 'mcr' | 'progress-review'; learner: LearnerDetail | null;
  learnerQuery: string; today: string; loading: boolean; error: string;
  onSchedule: (session: LearnerCalendarEvent) => void; titleOf: (session: LearnerCalendarEvent) => string;
  attendance: MeetingAttendance[]; timeZone?: string; busy: string | null; canAct: boolean;
  onAttend: (id: string) => void; onReport: (session: MeetingAttendance) => void;
}) {
  const headingId = useId();
  const eligible = sessions.map(session => ({ ...session, status: attendance.find(item => item.id === session.id)?.status || session.status }))
    .filter(session => !session.importedReview || (source === 'mcr'
    ? ['monthly coaching meeting', 'monthly coaching', 'mcm']
    : ['progress review', 'progress review (+ skills radar)']).includes(session.importedReview.type.trim().toLowerCase()));
  const selected = featuredSession(eligible, today);
  const state = attendance.find(item => item.id === selected?.id);
  const meeting = selected && state ? { ...selected, durationMinutes: state.durationMinutes || 0, meetingLink: state.meetingLink, meetingProvider: state.meetingProvider,
    syncWarning: state.syncWarning || selected.syncWarning, invited: state.invited ?? selected.invited,
    eventKey: state.calendarEventKey || selected.eventKey } : selected;
  const review = source === 'progress-review';
  const label = review ? 'review' : 'coaching meeting';
  if (loading) return <section aria-label={`Loading next ${label}`} aria-busy="true" className={`${styles.card} ${styles.loading}`}><div /><div /><div /></section>;
  if (error && !sessions.length) return null;
  if (!meeting) return <section aria-labelledby={headingId} className={`${styles.card} ${styles.empty}`}>
    <span className={styles.icon}><AppIcon className="ri-calendar-check-line" /></span>
    <div><h2 id={headingId}>No upcoming {review ? 'reviews' : 'coaching meetings'}</h2><p>Your next meeting will appear here when it is planned or scheduled.</p></div>
  </section>;
  const booked = meetingIsBooked(meeting);
  const isToday = booked && meeting.scheduledDate === today;
  const date = booked ? meeting.scheduledDate : meeting.targetDate || meeting.date;
  const joinUrl = booked ? meetingJoinUrl(meeting) : null;
  const syncWarning = booked ? meetingBookingWarning(meeting) : '';
  const path = review ? 'progress-reviews' : 'monthly-coaching';
  const detailsHref = `/learner/${path}/${encodeURIComponent(meeting.id)}?${learnerQuery}`;
  const duration = meeting.durationMinutes > 0 && (!meeting.importedReview || state?.durationMinutes) ? `${meeting.durationMinutes} minutes` : 'To be confirmed';
  return <section aria-labelledby={headingId} className={styles.card}>
    <div className={styles.heading}>
      <div className={styles.identity}><span className={styles.icon}><AppIcon className={review ? 'ri-file-chart-line' : 'ri-team-line'} /></span>
        <div><p className={styles.eyebrow}>{isToday ? `Today's ${label}` : booked ? `Your next ${label}` : `${review ? 'Review' : 'Coaching meeting'} to schedule`}</p>
          <h2 id={headingId}>{titleOf(meeting)}</h2><p className={styles.subtitle}>{meeting.importedReview?.type || (review ? 'Progress Review' : 'Monthly Coaching Meeting')}{learner?.programme ? ` · ${learner.programme}` : ''}</p></div>
      </div>
      <span className={styles.badge} data-today={isToday && !syncWarning}>{syncWarning ? 'Calendar sync pending' : isToday ? 'Today' : booked ? 'Scheduled' : 'Not scheduled'}</span>
    </div>
    <dl className={styles.details}>
      <Detail icon="ri-user-star-line" label={review ? 'Reviewer / Coach' : 'Coach'} value={meeting.coachName || 'Not assigned yet'} />
      {review && <Detail icon="ri-briefcase-line" label="Line manager" value={learner?.lineManager || 'Not assigned yet'} />}
      <Detail icon="ri-calendar-event-line" label={booked ? 'Date' : 'Target date'} value={date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'To be confirmed'} />
      <Detail icon="ri-time-line" label="Timing" value={meetingTimeRange(meeting)} />
      <Detail icon="ri-timer-line" label={booked ? 'Duration' : 'Planned duration'} value={duration} />
      <Detail icon="ri-video-chat-line" label="Location" value={joinUrl ? (meeting.meetingProvider || 'Online meeting') : 'To be confirmed'} />
      {review && <Detail icon="ri-quill-pen-line" label="Your signature" value={meeting.learnerSigned ? 'Signed' : meeting.importedReview ? 'Not recorded' : 'Not signed yet'} />}
    </dl>
    {syncWarning && <p role="status" className={styles.syncWarning}>{syncWarning}</p>}
    <div className={styles.footer}>
      <div className={styles.help}><p>{booked ? review ? 'Review your progress, reflections and targets before the meeting.' : 'Prepare your learning updates, questions and next actions.' : 'Choose a date and time with your coach to confirm this meeting.'}</p>
        {booked && !state?.attendanceConfirmed && !state?.absenceReported && <p>{!canAct ? 'Attendance can be recorded by the learner or an administrator.' : !isToday ? 'Attend will be available on the meeting date.' : !state?.durationMinutes ? 'Your coach needs to confirm the meeting duration before attendance can be recorded.' : `Select Attend today to receive the full ${state.durationMinutes} minutes of attendance.`}</p>}
        {booked && timeZone && <p>Times shown in {timeZone}.</p>}
      </div>
      <div className={styles.actions}>
        {booked && <MeetingAttendanceActions featured session={state} busy={Boolean(busy)} canAct={canAct} onAttend={() => onAttend(meeting.id)} onReport={() => state && onReport(state)} onReschedule={() => onSchedule(meeting)} />}
        <button type="button" disabled={!canAct || Boolean(busy)} onClick={() => onSchedule(meeting)} className={booked ? styles.view : styles.schedule}><AppIcon className="ri-calendar-event-line" />{booked ? 'Reschedule' : 'Schedule meeting'}</button>
        {joinUrl && <a href={joinUrl} target="_blank" rel="noopener noreferrer" className={styles.join}><AppIcon className="ri-video-chat-line" />Join meeting</a>}
        <Link to={detailsHref} className={styles.view}>View {review ? 'review' : 'meeting'}<AppIcon className="ri-arrow-right-line" /></Link>
        {booked && (!meeting.importedReview || state?.calendarEventKey) && <Link to={`/learner/calendar?${learnerQuery}&event=${encodeURIComponent(meeting.eventKey || meeting.id)}&date=${date}`} className={styles.view}>View in calendar<AppIcon className="ri-calendar-line" /></Link>}
      </div>
    </div>
  </section>;
}

function Detail({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div><dt><AppIcon className={icon} />{label}</dt><dd>{value}</dd></div>;
}
