import { useEffect, useState } from 'react';
import type { ComponentMarking, LearnerKind } from '@/api/learnerDetail';
import type { SubmissionAttempt } from '@/api/assignmentAttempts';
import { readLearnerJson } from '@/api/learnerRead';
import { formatSystemTimestamp } from '@/lib/format';
import { AssignmentDownload } from './AssignmentDownload';
import { AssignmentFeedback } from './AssignmentFeedback';
import { statusLabels } from './model';
import styles from './monthlySubmission.module.css';

export function AssignmentSubmissions({ kind, learnerId, activityId, status, submissionCount, marking, month }: {
  kind: LearnerKind; learnerId: string; activityId: string; status: string;
  submissionCount?: number; marking?: ComponentMarking; month?: string;
}) {
  const [attempts, setAttempts] = useState<SubmissionAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAttempts([]); setError('');
    if (status === 'todo' || submissionCount === 0) { setLoading(false); return; }
    setLoading(true);
    const query = new URLSearchParams({ learnerKind: kind, learnerId, activityType: 'assignment', activityId });
    void readLearnerJson<{ submission?: { submissionAttempts?: SubmissionAttempt[] } | null }>(
      `/learner_api/reflection/submissions/?${query}`, { signal: controller.signal, revalidate: true },
    ).then(result => {
      if (!controller.signal.aborted) setAttempts(result.submission?.submissionAttempts || []);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not load previous submissions. Please try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, learnerId, activityId, status, submissionCount, refresh]);

  return <>
    {!attempts.length && <AssignmentFeedback marking={marking} status={status} />}
    {!loading && !error && !attempts.length && ['accepted', 'partial', 'referred', 'returned', 'rejected', 'completed'].includes(status) && <AssignmentDownload kind={kind} learnerId={learnerId} activityId={activityId} month={month} />}
    {loading && <p role="status" className={styles.feedbackReviewer}>Loading submission history…</p>}
    {error && <div role="alert" className={styles.error}>{error}<br /><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry submissions</button></div>}
    {attempts.length > 0 && <section className={styles.submissions} aria-label="Assignment submissions">
      <div className={styles.sectionHeading}><h3>Submission history</h3>
        <button type="button" className={styles.secondary} onClick={() => setRefresh(value => value + 1)}>Refresh submissions</button>
      </div>
      {attempts.map(attempt => <article key={attempt.number} className={styles.submissionAttempt} aria-label={`Submission ${attempt.number}`}>
        <div className={styles.sectionHeading}>
          <h4>Submission {attempt.number}</h4>
          <span className={styles.status} data-status={attempt.status}>{attempt.status === 'rejected' ? 'Rejected' : statusLabels[attempt.status] || attempt.status.replaceAll('_', ' ')}</span>
        </div>
        {attempt.submittedAt && <p className={styles.feedbackReviewer}>Submitted: {formatSystemTimestamp(attempt.submittedAt, { dateStyle: 'medium', timeStyle: 'short' })} (UK time)</p>}
        <details className={styles.submittedAnswer}><summary>View submitted answer</summary><p>{attempt.answer || 'No written answer recorded.'}</p></details>
        <h5>Coach feedback</h5>
        <p className={styles.attemptFeedback}>{attempt.coachFeedback || (['submitted_for_tutor_review', 'pending', 'escalated'].includes(attempt.status)
          ? 'Awaiting coach review. Feedback will appear here once reviewed.' : 'No written feedback was added to this submission.')}</p>
        {(attempt.reviewedBy || attempt.reviewedAt) && <p className={styles.feedbackReviewer}>
          {attempt.reviewedBy && `Reviewed by ${attempt.reviewedBy}`}
          {attempt.reviewedAt && ` · ${formatSystemTimestamp(attempt.reviewedAt, { dateStyle: 'medium', timeStyle: 'short' })} (UK time)`}
        </p>}
        <AssignmentDownload key={`${attempt.number}:${attempt.status}:${attempt.reviewedAt}:${attempt.coachFeedback}`} kind={kind} learnerId={learnerId} activityId={activityId} month={month} attempt={attempt.number} />
      </article>)}
    </section>}
  </>;
}
