import { useId } from 'react';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { isLectureLive, lectureJoinUrl, lectureToday } from '../liveLecture';
import styles from '../attendance.module.css';

export default function FeaturedLecture({ lecture, now, timeZone, busy, canAttend, error, notice, onAttend, onReport }: {
  lecture: AttendanceLecture | null; now: number; timeZone?: string; busy: boolean; canAttend: boolean;
  error: string; notice: string; onAttend: (lecture: AttendanceLecture) => void; onReport: (lecture: AttendanceLecture) => void;
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
  const joinUrl = lectureJoinUrl(lecture);
  const hasDuration = Number.isFinite(lecture.durationMinutes) && (lecture.durationMinutes || 0) > 0;
  const hours = hasDuration ? Number((lecture.durationMinutes! / 60).toFixed(2)) : null;
  const help = attended ? `Attendance recorded${lecture.creditedMinutes != null ? ` · ${Number((lecture.creditedMinutes / 60).toFixed(2))} hours credited` : ''}.` :
    !canAttend ? 'Attendance can be recorded by the learner or an administrator.' :
      !today ? 'Attend will be available on the lecture date.' :
        !hasDuration ? 'The lecture duration is not available yet. Please contact support.' :
          `Select Attend today to receive the full ${hours} ${hours === 1 ? 'hour' : 'hours'} of attendance.`;
  return <section aria-labelledby={headingId}>
    <Panel className={styles.featuredLecture}>
      <div className={styles.featuredTop}>
        <div className={styles.featuredIdentity}>
          <span className={styles.featuredIcon}><AppIcon className="ri-presentation-line" /></span>
          <div><p className={styles.featuredEyebrow}>{today ? "Today's lecture" : 'Your next lecture'}</p>
            <h2 id={headingId}>{lecture.title}</h2><p className={styles.featuredModule}>{lecture.module}</p></div>
        </div>
        <span className={styles.featuredBadge} data-live={live}>{attended ? 'Attended' : live ? 'Live now' : today ? 'Today' : 'Upcoming'}</span>
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
        <div><p id={helpId}>{help}</p>{lecture.startTime && <p className={styles.featuredTimezone}>Times shown in {timeZone || 'Europe/London'}.</p>}</div>
        <div className={styles.featuredActions}>
          <button type="button" className={`primary-action ${styles.attendButton}`} disabled={busy || attended || !today || !hasDuration || !canAttend}
            aria-describedby={helpId} onClick={() => onAttend(lecture)}><AppIcon className="ri-checkbox-circle-line" />{busy ? 'Saving…' : attended ? 'Attended' : 'Attend'}</button>
          <button type="button" className={styles.reportButton} disabled={busy || !lecture.canReportAbsence}
            onClick={() => onReport(lecture)}><AppIcon className="ri-calendar-close-line" />{lecture.absenceReport ? 'Absence reported' : 'Report Absence'}</button>
          {today && joinUrl && <a className={styles.joinSession} href={joinUrl} target="_blank" rel="noopener noreferrer">Join session<AppIcon className="ri-external-link-line" /></a>}
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
