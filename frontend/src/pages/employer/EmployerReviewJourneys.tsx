import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, Check, CircleAlert, ClipboardPenLine, Layers, LoaderCircle, Users, Workflow } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { formatReviewDate, learnerHref, learnerKey, orderReviewJourney, reviewDate, reviewLabels, reviewState, type DashboardReviews } from './employerDashboardData';
import styles from './EmployerReviewJourneys.module.css';

type Props = {
  employerId: string;
  learners: EmployerLearnerCard[];
  totalLearners: number;
  reviews: DashboardReviews;
  onRetry: () => void;
  onClearFilters: () => void;
};

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
        const completed = events.filter(event => reviewState(event) === 'completed').length;
        const signatures = events.filter(event => reviewState(event) === 'signature').length;
        const href = learnerHref(employerId, learner, 'reviews');
        const initials = learner.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
        return (
          <article key={learnerKey(learner)} className={styles.learner} aria-label={`${learner.name} reviews`}>
            <header className={styles.learnerHeader}>
              <div className={styles.identity}>
                <span className={styles.avatar} data-tone={Number(learner.id) % 2 ? 'blue' : 'mint'} aria-hidden>{initials || '?'}</span>
                <div>
                  <h3><Link to={href}>{learner.name}</Link></h3>
                  <div className={styles.metadata}>
                    <span><BookOpen size={14} aria-hidden />{learner.programme || 'Programme not assigned'}</span>
                    <span><Layers size={14} aria-hidden />{learner.cohort || 'Cohort not assigned'}</span>
                  </div>
                </div>
              </div>
              <div className={styles.actions}>
                {ready && signatures > 0 && <span className={styles.signatureNotice}><ClipboardPenLine size={15} aria-hidden />{signatures} awaiting your signature</span>}
                <Link className={styles.openButton} to={href} aria-label={`View reviews for ${learner.name}`}>
                  View reviews{ready ? ` (${events.length})` : ''}<ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            </header>

            {ready ? events.length ? (
              <>
                <div className={styles.timelineHeader}>
                  <span>Review timeline</span><span><Check size={14} aria-hidden />{completed} of {events.length} completed</span>
                </div>
                <div className={styles.timelineScroll} role="region" aria-label={`${learner.name} review timeline`} tabIndex={0}>
                  <ol className={styles.timeline}>
                    {events.map(event => {
                      const state = reviewState(event);
                      const date = reviewDate(event);
                      const StatusIcon = state === 'completed' ? Check : state === 'signature' ? ClipboardPenLine : CalendarDays;
                      return (
                        <li key={event.eventKey} data-status={state}>
                          <Link to={href} className={styles.review} aria-label={`${learner.name}: ${event.title}, ${reviewLabels[state]}, ${formatReviewDate(date)}`}>
                            <span className={styles.marker}><StatusIcon size={16} aria-hidden /></span>
                            <div className={styles.reviewBody}>
                              <span className={styles.status}>{reviewLabels[state]}</span>
                              <strong>{event.title}{event.occurrenceNumber ? ` #${event.occurrenceNumber}` : ''}</strong>
                              <span className={styles.date}><CalendarDays size={14} aria-hidden />{date ? <time dateTime={date}>{formatReviewDate(date)}</time> : 'Not scheduled'}</span>
                            </div>
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
