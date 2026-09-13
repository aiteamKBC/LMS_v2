import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Headphones, Users, Video } from 'lucide-react';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { reviewDate } from './model';
import { dateLabel, State } from './presentation';
import styles from './trainingPlan.module.css';
import layout from './TrainingPlanDetails.module.css';

type Props = Pick<TrainingPlanDashboard, 'reviews' | 'coach'> & { kind: string; learnerId: string; today: string };

/** Reviews belong to the programme, not to the currently selected module. */
export function ProgrammeReviews({ reviews: incoming, coach, kind, learnerId, today }: Props) {
  const reviews = incoming.filter(review => review.source !== 'student-support' && review.status !== 'cancelled')
    .sort((a, b) => reviewDate(a).localeCompare(reviewDate(b)));
  const learnerQuery = `kind=${encodeURIComponent(kind)}&learner=${encodeURIComponent(learnerId)}`;
  const calendarHref = (eventKey: string) => `/learner/calendar?${learnerQuery}&event=${encodeURIComponent(eventKey)}`;

  return <section className={`${styles.panel} ${layout.reviews}`} aria-label="Programme reviews">
    <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Your coaching</p><h2>Programme reviews</h2></div><Users size={20} /></div>
    <p className={styles.hint}>{reviews.filter(review => review.status === 'completed').length} of {reviews.length} completed · Whole programme</p>
    <div className={`${styles.reviewList} ${layout.reviewList}`}>
      {reviews.length ? reviews.map(review => {
        const title = `${review.title}${review.sequence ? ` ${review.sequence}` : ''}`;
        const needsBooking = review.status === 'not-scheduled';
        const meetingLink = ['scheduled', 'in-progress'].includes(review.status)
          && /^https?:\/\//i.test(review.meetingLink || '') ? review.meetingLink : null;
        const status = ({ completed: 'Completed', scheduled: review.invited === false ? 'Booking pending' : 'Booked',
          'not-scheduled': reviewDate(review) && reviewDate(review) < today ? 'Overdue' : 'Not booked',
          'awaiting-signature': 'Awaiting signatures', 'in-progress': 'In progress' }[review.status] || 'Not booked');
        const action = needsBooking ? 'Schedule' : review.status === 'completed' ? 'View'
          : review.status === 'awaiting-signature' ? 'Review & sign' : 'View booking';
        return <article className={styles.review} key={review.eventKey} aria-label={title}>
          <span className={styles.reviewIcon}>{review.status === 'completed' ? <CheckCircle2 size={18} /> : <CalendarDays size={18} />}</span>
          <div><h3>{title}</h3><p>{dateLabel(reviewDate(review))}{review.scheduledTime ? ` · ${review.scheduledTime.slice(0, 5)} UK time` : ''}</p>
            <State value={status} />
            {['scheduled', 'in-progress'].includes(review.status) && !meetingLink && <p>Meeting link pending</p>}
          </div>
          {meetingLink
            ? <a className={styles.reviewAction} href={meetingLink} target="_blank" rel="noopener noreferrer">Attend<Video size={13} /></a>
            : <Link className={styles.reviewAction} to={`${calendarHref(review.eventKey)}${needsBooking ? '&action=schedule' : ''}`}>{action}<ArrowRight size={13} /></Link>}
        </article>;
      }) : <p className={styles.empty}>Your reviews will appear here once planned.</p>}
    </div>
    <Link className={styles.textLink} to={`/learner/progress-reviews?${learnerQuery}`}>View all your reviews<ArrowRight size={15} /></Link>
    <div className={`${styles.support} ${layout.support}`}><Headphones size={20} /><div><h3>Need a little support?</h3>
      <p>{coach.name ? `Book a session with ${coach.name}.` : 'Your coach booking link will appear here once available.'}</p>
      {coach.bookingUrl && <a href={coach.bookingUrl} target="_blank" rel="noopener noreferrer">Book a support session<ArrowRight size={14} /></a>}
    </div></div>
  </section>;
}
