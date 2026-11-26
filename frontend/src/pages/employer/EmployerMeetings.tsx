import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useEffect, useState } from 'react';
import { CalendarDays, UserRound, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { fetchEmployerTeamsMeetings, type EmployerTeamsMeetings } from '@/api/employerMeetings';
import { presentReview } from '@/pages/learner/progress-reviews/reviewPresentation';
import { meetingTimeRange } from '@/pages/learner/reviews/featuredSession';
import { formatReviewDate, learnerHref, learnerReviewHref, learnerKey, progressReviews, type DashboardReviews } from './employerDashboardData';
import styles from './EmployerPortalPage.module.css';

export function EmployerMeetings({ employerId, learners, reviews, today, returnState }: {
  employerId: string; learners: EmployerLearnerCard[]; reviews: DashboardReviews; today: string; returnState?: unknown;
}) {
  const [attempt, setAttempt] = useState(0);
  const [teams, setTeams] = useState<{ employerId: string; data?: EmployerTeamsMeetings; error?: boolean }>({ employerId });
  useEffect(() => {
    const controller = new AbortController();
    setTeams({ employerId });
    void fetchEmployerTeamsMeetings(employerId, controller.signal)
      .then(data => { if (!controller.signal.aborted) setTeams({ employerId, data }); })
      .catch(() => { if (!controller.signal.aborted) setTeams({ employerId, error: true }); });
    return () => controller.abort();
  }, [employerId, attempt]);
  const currentTeams = teams.employerId === employerId ? teams : undefined;
  const teamsLoading = !currentTeams?.data && !currentTeams?.error;
  const teamsFailed = currentTeams?.error || (currentTeams?.data && currentTeams.data.status !== 'ready');
  const loading = learners.some(learner => !reviews[learnerKey(learner)] || reviews[learnerKey(learner)].status === 'loading');
  const failed = learners.some(learner => reviews[learnerKey(learner)]?.status === 'error');
  const meetings = learners.flatMap(learner => progressReviews(reviews[learnerKey(learner)]?.data || [])
    .map(event => ({ learner, event, presentation: presentReview(event, undefined, today, undefined, 'employer') })))
    .filter(({ presentation }) => presentation.booked && !presentation.past)
    .sort((a, b) => `${a.event.scheduledDate}T${a.event.scheduledTime || '23:59'}`
      .localeCompare(`${b.event.scheduledDate}T${b.event.scheduledTime || '23:59'}`));
  const normalUrl = (value: string) => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  };
  const invitations = (currentTeams?.data?.meetings || []).filter(invitation => !meetings.some(({ event, presentation }) =>
    presentation.joinUrl && normalUrl(presentation.joinUrl) === normalUrl(invitation.joinUrl)
    && event.scheduledDate === invitation.scheduledDate && event.scheduledTime?.slice(0, 5) === invitation.scheduledTime));
  const count = meetings.length + invitations.length;
  const timeline = [
    ...meetings.map(meeting => ({ kind: 'lms' as const, when: `${meeting.event.scheduledDate}T${meeting.event.scheduledTime || '23:59'}`, meeting })),
    ...invitations.map(invitation => ({ kind: 'teams' as const, when: `${invitation.scheduledDate}T${invitation.scheduledTime}`, invitation })),
  ].sort((a, b) => a.when.localeCompare(b.when));
  return <section className={styles.panel} aria-labelledby="employer-meetings">
    <header className={styles.panelHeader}><h2 id="employer-meetings"><CalendarDays size={21} />Meetings to attend{count > 0 ? ` (${count})` : ''}</h2></header>
    <p className={styles.chartCaption}>LMS bookings and Teams invitations with your learners. Teams calendars checked for the next 90 days. Times shown in UK time.</p>
    <div className={styles.meetingList}>
      {timeline.map(item => {
        if (item.kind === 'teams') {
          const { invitation } = item;
          const joinUrl = normalUrl(invitation.joinUrl);
          return <article key={`teams:${invitation.id}`} className={styles.meetingItem}>
            <div>
              <div>{invitation.learners.map(learner => <Link key={`${learner.kind}:${learner.id}`} className={styles.learnerName} to={learnerHref(employerId, learner, 'reviews')} state={returnState}>{learner.name} </Link>)}</div>
              <strong className={styles.reviewTitle}>{invitation.title}</strong>
              <span className={styles.meetingWhen}><CalendarDays size={14} />{formatReviewDate(invitation.scheduledDate)} · {invitation.scheduledTime} – {invitation.endTime}</span>
              <small>Teams invitation</small>
              {invitation.coachName && <small className={styles.meetingCoach}><UserRound size={13} />With {invitation.coachName}</small>}
            </div>
            <div className={styles.meetingActions}>
              {joinUrl && <a className={styles.viewButton} href={joinUrl} target="_blank" rel="noopener noreferrer" aria-label={`Join Teams: ${invitation.title}`}><Video size={16} />Join meeting</a>}
            </div>
          </article>;
        }
        const { learner, event, presentation } = item.meeting;
        const syncPending = event.invited === false || Boolean(event.syncState && event.syncState !== 'synced');
        const joinUrl = presentation.booked && !syncPending ? presentation.joinUrl : null;
        return <article key={`${learnerKey(learner)}:${event.eventKey}`} className={styles.meetingItem}>
          <div><Link className={styles.learnerName} to={learnerHref(employerId, learner, 'reviews')} state={returnState}>{learner.name}</Link>
            <Link className={styles.reviewTitle} to={learnerReviewHref(employerId, learner, event.eventKey)} state={returnState}>{event.title}{event.occurrenceNumber ? ` #${event.occurrenceNumber}` : ''}</Link>
            <span className={styles.meetingWhen}><CalendarDays size={14} />{formatReviewDate(event.scheduledDate)} · {meetingTimeRange(event)}</span>
            <small className={styles.meetingCoach}><UserRound size={13} />{event.coachName ? `With ${event.coachName}` : 'Coach to be confirmed'}</small>
          </div>
          <div className={styles.meetingActions}>
            {joinUrl ? <a className={styles.viewButton} href={joinUrl} target="_blank" rel="noopener noreferrer" aria-label={`Join ${learner.name}: ${event.title}`}><Video size={16} />Join meeting</a>
              : <span className={styles.unavailable}>{syncPending ? 'Invitation not confirmed. Contact your coach.' : 'Meeting link not available yet.'}</span>}
            <Link className={`${styles.textButton} ${styles.reviewActionLink}`} to={learnerReviewHref(employerId, learner, event.eventKey)} state={returnState}>View review</Link>
          </div>
        </article>;
      })}
      {loading && <p  className={styles.caption}><LoadingSkeleton label="Loading booked meetings…" variant="rows" /></p>}
      {teamsLoading && <LoadingSkeleton label="Checking Teams invitations" variant="rows" />}
      {teamsFailed && <div role="alert"><p className={styles.caption}>Some Teams invitations could not be checked. Available LMS bookings are still shown.</p><button type="button" className={styles.textButton} onClick={() => setAttempt(value => value + 1)}>Retry Teams invitations</button></div>}
      {failed && <p className={styles.caption}>Some meetings could not be loaded. Use Try again above.</p>}
      {!count && !loading && !failed && !teamsLoading && !teamsFailed && <p className={styles.caption}>No upcoming LMS bookings or Teams invitations found.</p>}
    </div>
  </section>;
}
