import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, ClipboardCheck, Clock3, GraduationCap, CalendarCheck, Sparkles } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { learnerHref, learnerKey, type DashboardAttendance, type DashboardReviews } from './employerDashboardData';
import { employerPerformance } from './employerPerformanceData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import { EmployerStatDialog } from './EmployerStatDialog';
import styles from './EmployerPerformance.module.css';

const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
const percent = (value: number | null) => value == null ? 'Unavailable' : `${number(value)}%`;
type Props = { employerId: string; learners: EmployerLearnerCard[]; records: EmployerLearningRecords;
  attendance: DashboardAttendance; reviews: DashboardReviews };

export function EmployerPerformanceCards({ employerId, learners, records, attendance, reviews }: Props) {
  const location = useLocation();
  const [open, setOpen] = useState<number | null>(null);
  const summary = employerPerformance(learners, records, attendance, reviews);
  const loading = learners.some(learner => !records[learnerKey(learner)]);
  const attendanceLoading = learners.some(learner => !attendance[learnerKey(learner)] || attendance[learnerKey(learner)].status === 'loading');
  const reviewsLoading = learners.some(learner => !reviews[learnerKey(learner)] || reviews[learnerKey(learner)].status === 'loading');
  const coverage = (available: number) => `${available} of ${learners.length} learners`;
  const cards = [
    { label: 'Average attendance', icon: Activity, value: percent(summary.rates[0].value), detail: coverage(summary.rates[0].available), tone: 'purple', field: 'attendance', pending: attendanceLoading },
    { label: 'Assignment submission', icon: ClipboardCheck, value: percent(summary.rates[1].value), detail: coverage(summary.rates[1].available), tone: 'green', field: 'assignments', pending: loading },
    { label: 'Average off-the-job hours', icon: Clock3, value: summary.hours.value == null ? 'Unavailable' : `${number(summary.hours.value)} h`, detail: `${percent(summary.rates[2].value)} of planned hours`, tone: 'blue', field: 'hours' },
    { label: 'Average KSBs', icon: GraduationCap, value: percent(summary.rates[3].value), detail: coverage(summary.rates[3].available), tone: 'amber', field: 'ksb', pending: loading },
    { label: 'Reviews', icon: CalendarCheck, value: summary.reviewsAvailable ? number(summary.reviewCount) : learners.length ? 'Unavailable' : '0', detail: `${summary.completedReviews} completed · ${coverage(summary.reviewsAvailable)}`, tone: 'rose', field: 'reviews', pending: reviewsLoading },
  ];
  const selected = open == null ? null : cards[open];
  return <>
    <section className={styles.cards} aria-label="Learning performance">
      {cards.map((card, index) => <button key={card.label} type="button" className={styles.card} data-tone={card.tone}
        onClick={() => setOpen(index)} aria-label={`${card.label}: ${card.pending && card.value === 'Unavailable' ? 'Loading' : card.value}`} aria-busy={card.pending || undefined}>
        <span className={styles.icon}><card.icon size={20} aria-hidden="true" /></span>
        <span className={styles.label}>{card.label}</span><strong>{card.pending && card.value === 'Unavailable' ? 'Loading…' : card.value}</strong>
        <small>{card.detail}</small>
      </button>)}
      <article className={styles.card} data-tone="overall" aria-label="Average performance: calculation pending">
        <span className={styles.icon}><Sparkles size={20} aria-hidden="true" /></span>
        <span className={styles.label}>Average performance</span><strong>—</strong><small>Calculation pending</small>
      </article>
    </section>
    {selected && <EmployerStatDialog title={selected.label} caption="Progress for the learners in your current filters. Unavailable records are excluded from each indicator."
      emptyMessage="No learners to show." onClose={() => setOpen(null)} rows={summary.rows.map(row => {
        const field = selected.field;
        const learnerReviews = reviews[learnerKey(row.learner)];
        const value = field === 'hours' ? row.hours == null ? 'Unavailable' : `${number(row.hours)} h`
          : field === 'reviews' ? learnerReviews?.status === 'ready' ? `${learnerReviews.data?.length ?? 0} reviews` : 'Unavailable'
          : percent(row[field as 'attendance' | 'assignments' | 'ksb' | 'reviews']);
        return { id: learnerKey(row.learner), primary: row.learner.name, secondary: row.learner.programme,
          meta: value, action: <Link to={learnerHref(employerId, row.learner, field === 'reviews' ? 'reviews' : 'plan')} state={location.state}>View learner</Link> };
      })} />}
  </>;
}
