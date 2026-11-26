import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Check, Circle, CircleAlert, Clock3, Signature, Users } from 'lucide-react';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { fetchEmployerMcmTimeline, type EmployerLearnerCard, type EmployerMcmTimelineEvent } from '@/api/employerPortal';
import { formatReviewDate } from './employerDashboardData';
import styles from './EmployerReviewJourneys.module.css';

const normalise = (value?: string) => (value || '').trim().toLowerCase().replace(/[ _]+/g, '-');
function presentation(event: EmployerMcmTimelineEvent) {
  const states = [event.status, event.bookingStatus].map(normalise);
  if (states.includes('completed')) return { tone: 'attended', label: 'Completed', Icon: Check };
  if (states.includes('awaiting-signature')) return { tone: 'awaiting-signature', label: 'Awaiting signatures', Icon: Signature };
  if (states.includes('in-progress')) return { tone: 'in-progress', label: 'In progress', Icon: Clock3 };
  if (event.scheduledDate && states.includes('scheduled')) return { tone: 'scheduled', label: 'Scheduled', Icon: CalendarDays };
  return { tone: 'planned', label: 'Planned', Icon: Circle };
}

export function EmployerMcmTimeline({ employerId, learner }: { employerId: string; learner: EmployerLearnerCard }) {
  const query = useQuery({
    queryKey: ['employer-mcm-timeline', employerId, learner.kind, learner.id],
    queryFn: ({ signal }) => fetchEmployerMcmTimeline(employerId, learner.kind, learner.id, signal),
  });
  const events = [...(query.data?.events || [])].sort((a, b) =>
    (a.targetDate || '9999-12-31').localeCompare(b.targetDate || '9999-12-31')
    || (a.occurrenceNumber ?? a.sequence ?? 0) - (b.occurrenceNumber ?? b.sequence ?? 0));

  return <section aria-label={`${learner.name} monthly coaching meetings`}>
    <div className={styles.timelineHeader}>
      <div><p className={styles.eyebrow}>YOUR LEARNER'S COACHING JOURNEY</p><h4>Monthly coaching meeting (MCM) timeline</h4></div>
      <div className={styles.timelineMeta}>
        <p className={styles.attendeeNote}><Users size={15} aria-hidden /><span>Attendees: <strong>Learner and Coach only.</strong></span></p>
        {query.isSuccess && <span className={styles.count}>{events.length} {events.length === 1 ? 'meeting' : 'meetings'}</span>}
      </div>
    </div>
    {query.isPending ? <div className={styles.notice}><LoadingSkeleton label="Loading monthly coaching meetings" variant="rows" /></div>
      : query.isError ? <div className={styles.error} role="alert"><CircleAlert size={20} aria-hidden /><p>Monthly coaching meetings could not be loaded for this learner.</p><button type="button" className={styles.retry} onClick={() => void query.refetch()}>Retry MCM timeline</button></div>
        : !events.length ? <p className={styles.notice}><CalendarDays size={19} aria-hidden />No monthly coaching meetings planned yet.</p>
          : <div className={styles.timelineScroll} role="region" aria-label={`${learner.name} MCM timeline`} tabIndex={0}>
            <ol className={styles.timeline}>
              {events.map((event, index) => {
                const { tone, label, Icon } = presentation(event);
                const date = event.scheduledDate || event.targetDate || event.date;
                const dateLabel = date ? formatReviewDate(date) : 'Date to confirm';
                const title = `MCM ${event.occurrenceNumber ?? event.sequence ?? index + 1}`;
                return <li key={event.eventKey} data-tone={tone} aria-label={`${title}, ${label}, ${dateLabel}`}>
                  <div className={styles.review} title={`${title} · ${label} · ${dateLabel}`}>
                    <span className={styles.date}>{dateLabel}</span>
                    <span className={styles.marker}><Icon size={14} strokeWidth={2.4} aria-hidden /></span>
                    <span className={styles.title}>{title}</span>
                  </div>
                </li>;
              })}
            </ol>
          </div>}
  </section>;
}
