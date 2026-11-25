import { Link, useLocation } from 'react-router-dom';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { learnerHref } from './employerDashboardData';
import { finite, ratio } from './employerPerformanceData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import styles from './EmployerPortalPage.module.css';

type Props = {
  employerId: string;
  learner: EmployerLearnerCard;
  resource?: EmployerLearningRecords[string];
};
const percentLabel = (value: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;

/** Assignment facts from the employer-owned learner overview. */
export function EmployerLearnerAssessmentCell({ employerId, learner, resource }: Props) {
  const location = useLocation();
  if (!resource || resource.status === 'loading') return <td><LoadingSkeleton label={`Loading ${learner.name} assessments`} variant="text" /></td>;
  if (resource.status === 'error' || !resource.data) return <td><span className={styles.unavailable}>Not available</span></td>;

  const facts = (resource.data.modules || []).filter((module, index, all) => all.findIndex(row => row.id === module.id) === index);
  // Older responses without assignment facts must not look like zero submissions.
  const assignments = facts.length && facts.every(module => module.assignments
    && finite(module.assignments.submitted) && finite(module.assignments.total))
    ? facts.reduce((sum, module) => ({ submitted: sum.submitted + module.assignments!.submitted,
      total: sum.total + module.assignments!.total }), { submitted: 0, total: 0 }) : null;
  const percent = assignments ? ratio(assignments.submitted, assignments.total) : null;

  return <td>{assignments ? assignments.total > 0 ? <div className={styles.progressCell} title="Assignments submitted / total assigned; submission does not mean marked or passed">
    <strong>{percentLabel(percent!)}</strong>
    <div className={styles.progressTrack} role="progressbar" aria-label={`${learner.name} assessment submission`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent!}><span style={{ width: `${percent}%` }} /></div>
    <Link className={styles.assessmentLink} to={learnerHref(employerId, learner, 'assignments')} state={location.state}>
      {assignments.submitted} / {assignments.total} submitted
    </Link>
  </div> : <span className={styles.unavailable}>No assessments assigned</span>
    : <span className={styles.unavailable}>{!facts.length && !resource.data.programme.length ? 'No assessments assigned' : 'Not available'}</span>}</td>;
}
