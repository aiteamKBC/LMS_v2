import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { isLectureJoinable, isLectureLive, lectureJoinUrl, lectureToday } from '../liveLecture';
import styles from '../attendance.module.css';

export default function FeaturedLecture({ lecture, now, timeZone, error, notice }: {
  lecture: AttendanceLecture | null; now: number; timeZone?: string;
  error: string; notice: string;
}) {
  const headingId = useId();
  const helpId = useId();
  if (!lecture) return <Panel className={styles.featuredEmpty}>
    <AppIcon className="ri-calendar-check-line" /><div><h2>No upcoming lectures</h2><p>Your next scheduled lecture will appear here.</p></div>
    {notice && <p role="status">{notice}</p>}
  </Panel>;
  const today = lecture.date === lectureToday(now, timeZone);
  const attended = ['completed', 'late'].includes(lecture.status);
  const live = isLectureLive(lecture, now);
  const end = Date.parse(lecture.endsAt || '');
  const ended = Number.isFinite(end) ? end <= now : lecture.date < lectureToday(now, timeZone);
  const joinUrl = lectureJoinUrl(lecture);
  const hasDuration = Number.isFinite(lecture.durationMinutes) && (lecture.durationMinutes || 0) > 0;
  const hours = hasDuration ? Number((lecture.durationMinutes! / 60).toFixed(2)) : null;
  const nativeTeams = lecture.source === 'microsoft-teams';
  const canJoin = Boolean(joinUrl) && isLectureJoinable(lecture, now);
  const help = ended ? 'Open this session to view its recording when published.'
    : 'Open this session for the live meeting and its recordings when published.';
  return <section aria-labelledby={headingId}>
    <Panel className={styles.featuredLecture}>
      <div className={styles.featuredTop}>
        <div className={styles.featuredIdentity}>
          <span className={styles.featuredIcon}><AppIcon className="ri-presentation-line" /></span>
          <div><p className={styles.featuredEyebrow}>{today ? "Today's lecture" : ended ? "This week's lecture" : 'Your next lecture'}</p>
            <h2 id={headingId}>{lecture.title}</h2><p className={styles.featuredModule}>{lecture.module}</p></div>
        </div>
        <span className={styles.featuredBadge} data-live={live}>{live ? 'Live now' : attended ? 'Attended' : ended ? 'Session ended' : today ? 'Today' : 'Upcoming'}</span>
      </div>
      {lecture.contentSummary && <p className={styles.featuredSummary}>{lecture.contentSummary}</p>}
      <dl className={styles.featuredDetails}>
        <Detail icon="ri-user-line" label="Tutor" value={lecture.tutor || 'Not assigned yet'} />
        <Detail icon="ri-team-line" label="Coach" value={lecture.coach || 'Not assigned yet'} />
        <Detail icon="ri-calendar-event-line" label="Date" value={new Date(`${lecture.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} />
        <Detail icon="ri-time-line" label="Timing" value={`${lecture.startTime || 'To be confirmed'}${lecture.endTime ? ` – ${lecture.endTime}` : ''}`} />
        <Detail icon="ri-timer-line" label="Duration" value={hours == null ? 'To be confirmed' : `${hours} ${hours === 1 ? 'hour' : 'hours'}`} />
      </dl>
      <div className={styles.featuredFooter}>
        <div><p id={helpId}>{help}</p>
          <p>{nativeTeams ? 'Attendance is verified using Teams attendance records.' : 'Opening a session does not record attendance.'}</p>
          {!lecture.componentHref && <p role="status">Session content is not linked yet. Please contact your tutor.</p>}
          {lecture.startTime && <p className={styles.featuredTimezone}>Times shown in {timeZone || 'Europe/London'}.</p>}</div>
        <div className={styles.featuredActions}>
          {lecture.componentHref
            ? <Link className={`primary-action ${styles.sessionButton}`} to={lecture.componentHref} aria-describedby={helpId}><AppIcon className="ri-presentation-line" />View session</Link>
            : <button type="button" className={`primary-action ${styles.sessionButton}`} disabled aria-describedby={helpId}><AppIcon className="ri-presentation-line" />View session</button>}
          {canJoin && joinUrl && <a className={styles.joinSession} href={joinUrl} target="_blank" rel="noopener noreferrer">Join meeting<AppIcon className="ri-external-link-line" /></a>}
        </div>
      </div>
      {error && <p role="alert" className={styles.attendError}>{error}</p>}
      {notice && <p role="status" className={styles.attendNotice}>{notice}</p>}
    </Panel>
  </section>;
}

function Detail({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div><dt><AppIcon className={icon} />{label}</dt><dd>{value}</dd></div>;
}
