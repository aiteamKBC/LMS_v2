import { CalendarDays, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { presentReview } from '@/pages/learner/progress-reviews/reviewPresentation';
import { meetingTimeRange } from '@/pages/learner/reviews/featuredSession';
import { formatReviewDate, learnerHref, learnerKey, progressReviews, type DashboardReviews } from './employerDashboardData';
import styles from './EmployerPortalPage.module.css';

export function EmployerMeetings({ employerId, learners, reviews, today }: {
  employerId: string; learners: EmployerLearnerCard[]; reviews: DashboardReviews; today: string;
}) {
  const loading = learners.some(learner => !reviews[learnerKey(learner)] || reviews[learnerKey(learner)].status === 'loading');
  const failed = learners.some(learner => reviews[learnerKey(learner)]?.status === 'error');
  const meetings = learners.flatMap(learner => progressReviews(reviews[learnerKey(learner)]?.data || [])
    .map(event => ({ learner, event, presentation: presentReview(event, undefined, today, undefined, 'employer') })))
    .filter(({ presentation }) => presentation.booked && !presentation.past)
    .sort((a, b) => `${a.event.scheduledDate}T${a.event.scheduledTime || '23:59'}`
      .localeCompare(`${b.event.scheduledDate}T${b.event.scheduledTime || '23:59'}`));
  return <section className={styles.panel} aria-labelledby="employer-meetings">
    <header className={styles.panelHeader}><h2 id="employer-meetings"><CalendarDays size={21} />Meetings to attend{meetings.length > 0 ? ` (${meetings.length})` : ''}</h2></header>
    <p className={styles.chartCaption}>Your booked progress reviews with learners and coaches. Times shown in UK time.</p>
    <div className={styles.meetingList}>
      {meetings.map(({ learner, event, presentation }) => {
        const syncPending = event.invited === false || Boolean(event.syncState && event.syncState !== 'synced');
        const joinUrl = !syncPending ? presentation.joinUrl : null;
        return <article key={`${learnerKey(learner)}:${event.eventKey}`} className={styles.meetingItem}>
          <div><Link className={styles.learnerName} to={learnerHref(employerId, learner, 'reviews')}>{learner.name}</Link>
            <strong>{event.title}{event.occurrenceNumber ? ` #${event.occurrenceNumber}` : ''}</strong>
            <span>{formatReviewDate(event.scheduledDate)} · {meetingTimeRange(event)}</span>
            <small>{event.coachName ? `With ${event.coachName}` : 'Coach to be confirmed'}</small>
          </div>
          <div className={styles.meetingActions}>
            {joinUrl ? <a className={styles.viewButton} href={joinUrl} target="_blank" rel="noopener noreferrer" aria-label={`Join ${learner.name}: ${event.title}`}><Video size={16} />Join meeting</a>
              : <span className={styles.unavailable}>{syncPending ? 'Invitation not confirmed. Contact your coach.' : 'Meeting link not available yet.'}</span>}
            <Link className={styles.textButton} to={learnerHref(employerId, learner, 'reviews')}>View reviews</Link>
          </div>
        </article>;
      })}
      {loading && <p role="status" className={styles.caption}>Loading booked meetings…</p>}
      {failed && <p className={styles.caption}>Some meetings could not be loaded. Use Try again above.</p>}
      {!meetings.length && !loading && !failed && <p className={styles.caption}>No upcoming meetings booked. Planned reviews will appear here once a date is booked.</p>}
    </div>
  </section>;
}
