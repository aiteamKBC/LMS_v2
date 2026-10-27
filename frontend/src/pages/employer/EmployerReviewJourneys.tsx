import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, Check, Circle, CircleAlert, ClipboardPenLine, Clock3, Layers, LoaderCircle, Signature, Users, Workflow, X } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { formatReviewDate, learnerHref, learnerReviewHref, learnerKey, nextReview, orderReviewJourney, reviewDate, reviewLabels, reviewState, type DashboardReviews } from './employerDashboardData';
import styles from './EmployerReviewJourneys.module.css';
import { isAptemReview } from '@/pages/learner/progress-reviews/reviewPresentation';
import selection from '@/pages/learner/reviews/reviewMarkerSelection.module.css';
import { completedReviewTimelineStatus, reviewTimelineStatus, type TimelineStatus } from '@/pages/learner/reviews/reviewTimelineStatus';

type Props = {
  employerId: string;
  learners: EmployerLearnerCard[];
  totalLearners: number;
  reviews: DashboardReviews;
  onRetry: () => void;
  onClearFilters: () => void;
};

const timelineStatuses: TimelineStatus[] = ['planned', 'scheduled', 'in-progress', 'awaiting-signature', 'attended', 'missed'];
const timelineStatusLabels: Record<TimelineStatus, string> = {
  planned: 'Planned', scheduled: 'Scheduled', 'in-progress': 'In progress',
  'awaiting-signature': 'Awaiting signatures', attended: 'Attended', missed: 'Missed',
};
const timelineStatusIcons = {
  planned: Circle, scheduled: CalendarDays, 'in-progress': Clock3,
  'awaiting-signature': Signature, attended: Check, missed: X,
};

function timelineStatus(event: Parameters<typeof completedReviewTimelineStatus>[0]): TimelineStatus {
  if (event.source !== 'progress-review') return reviewTimelineStatus(event);
  const state = reviewState(event);
  return completedReviewTimelineStatus(event, undefined,
    state === 'signature' || state === 'signatures' ? 'awaiting-signature' : state);
}

/** The full reviews page keeps each learner's complete timeline on its own row. */
export function EmployerReviewJourneys({ employerId, learners, totalLearners, reviews, onRetry, onClearFilters }: Props) {
  return (
    <section className={styles.journeys} aria-labelledby="employer-reviews">
      <header className={styles.heading}>
        <div>
          <h2 id="employer-reviews"><Workflow size={21} aria-hidden />Progress review journey</h2>
          <p>Review dates, progress and signatures, organised by learner.</p>
        </div>
        <span className={styles.learnerCount}><Users size={16} aria-hidden />{learners.length} of {totalLearners} learners</span>
      </header>

      {learners.length > 0 && <ul className={styles.legend} aria-label="Review status colours">
        {timelineStatuses.map(status => <li key={status} data-status={status}><span aria-hidden="true" />{timelineStatusLabels[status]}</li>)}
      </ul>}

      {!learners.length && (
        <div className={styles.empty}>
          <Users size={30} aria-hidden />
          <h3>{totalLearners ? 'No matching learners' : 'No learners linked yet'}</h3>
          <p>{totalLearners ? 'Try another search or clear your filters.' : 'Linked learners and their progress reviews will appear here.'}</p>
          {totalLearners > 0 && <button type="button" className={styles.retry} onClick={onClearFilters}>Clear filters</button>}
        </div>
      )}

      {learners.map(learner => {
        const resource = reviews[learnerKey(learner)];
        const ready = resource?.status === 'ready';
        const events = orderReviewJourney(resource?.data || []);
        const upcomingKey = nextReview(resource?.data)?.eventKey;
        const completed = events.filter(event => reviewState(event) === 'completed').length;
        const signatures = events.filter(event => reviewState(event) === 'signature').length;
        const href = learnerHref(employerId, learner, 'reviews');
        const initials = learner.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
        return (
          <article key={learnerKey(learner)} className={styles.learner} aria-label={`${learner.name} reviews`}>
            <header className={styles.learnerHeader}>
              <div className={styles.identity}>
                <span className={styles.avatar} aria-hidden>{initials || '?'}</span>
                <div>
                  <h3><Link to={href}>{learner.name}</Link></h3>
                  <div className={styles.metadata}>
                    <span><BookOpen size={14} aria-hidden />{learner.programme || 'Programme not assigned'}</span>
                    <span><Layers size={14} aria-hidden />{learner.cohort || 'Cohort not assigned'}</span>
                  </div>
                </div>
              </div>
              <div className={styles.actions}>
                {ready && events.length > 0 && <span className={styles.completedNotice}><Check size={14} aria-hidden />{completed} of {events.length} completed</span>}
                {ready && signatures > 0 && <span className={styles.signatureNotice}><ClipboardPenLine size={15} aria-hidden />{signatures} awaiting your signature</span>}
                <Link className={styles.openButton} to={href} aria-label={`View reviews for ${learner.name}`}>
                  View reviews{ready ? ` (${events.length})` : ''}<ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            </header>

            {ready ? events.length ? (
              <>
                <div className={styles.timelineHeader}><div><p className={styles.eyebrow}>YOUR LEARNER'S REVIEW JOURNEY</p><h4>Progress review timeline</h4></div><span className={styles.count}>{events.length} {events.length === 1 ? 'review' : 'reviews'}</span></div>
                <div className={styles.timelineScroll} role="region" aria-label={`${learner.name} review timeline`} tabIndex={0}>
                  <ol className={styles.timeline}>
                    {events.map((event, index) => {
                      const state = reviewState(event);
                      const tone = timelineStatus(event);
                      const date = reviewDate(event);
                      const StatusIcon = timelineStatusIcons[tone];
                      return (
                        <li key={event.eventKey} data-status={state} data-tone={tone} data-active={event.eventKey === upcomingKey} data-selection={isAptemReview(event) ? 'marker' : undefined}>
                          <Link to={learnerReviewHref(employerId, learner, event.eventKey)} className={`${styles.review} ${selection.control}`} data-selection={isAptemReview(event) ? 'marker' : undefined} aria-current={event.eventKey === upcomingKey ? 'step' : undefined} aria-label={`${learner.name}: Review ${index + 1}, ${reviewLabels[state]}, ${formatReviewDate(date)}`}>
                            <span className={styles.date}>{date ? formatReviewDate(date) : 'Date to confirm'}</span>
                            <span className={`${styles.marker} ${selection.marker}`}><StatusIcon size={14} strokeWidth={2.4} aria-hidden /></span>
                            <span className={styles.title}>Review {index + 1}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </>
            ) : <p className={styles.notice}><CalendarDays size={19} aria-hidden />No progress reviews planned yet.</p>
              : resource?.status === 'error' ? <div className={styles.error} role="alert"><CircleAlert size={20} aria-hidden /><p>Reviews could not be loaded for this learner.</p><button type="button" className={styles.retry} onClick={onRetry}>Retry reviews</button></div>
                : <p className={styles.notice} role="status"><LoaderCircle size={19} aria-hidden />Loading progress reviews…</p>}
          </article>
        );
      })}
    </section>
  );
}
