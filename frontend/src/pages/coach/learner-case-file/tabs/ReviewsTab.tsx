import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusLabel } from '@/pages/coach/shared/calendarEvents';
import type { useCaseFileReviews } from '../useCaseFileReviews';
import { ReferencePanel } from '../components/CaseFilePrimitives';
import styles from '../learnerCaseFile.module.css';

function reviewDate(value: string | null) {
  if (!value) return '--';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export function ReviewsTab({ reviewsState }: { reviewsState: ReturnType<typeof useCaseFileReviews> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const rows = reviewsState.data?.reviews || [];
  const summary = reviewsState.data?.summary;
  const summaries = [['Total Reviews', summary?.total], ['Progress Reviews', summary?.progressReviews],
    ['Monthly Coaching Meetings', summary?.monthlyCoachingMeetings], ['Completed', summary?.completed], ['Upcoming', summary?.upcoming]] as const;
  const visible = rows.filter(row => (type === 'all' || row.type === type) && (status === 'all'
    || (status === 'completed' ? row.status === 'completed' : !['completed', 'cancelled'].includes(row.status))));
  return <div className={styles.stack}>
    {(reviewsState.data?.reviewGenerationIssues || []).map(issue => <div key={issue.code} role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <p>Review schedule unavailable</p><p>{reviewGenerationIssueMessage(issue.code)}</p>
    </div>)}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Review summary">
      {summaries.map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><strong className="block text-2xl">{value ?? '--'}</strong><span className="text-xs">{label}</span></div>)}
    </div>
    <ReferencePanel title="Review History" subtitle="Curriculum reviews and coaching meetings for this learner" icon="ri-file-list-3-line" tone="primary">
      {reviewsState.error && <div role="alert">{reviewsState.error} <button type="button" onClick={reviewsState.retry}>Retry reviews</button></div>}
      <div className="mb-4 flex flex-wrap gap-3" aria-label="Review filters">
        <div className="flex flex-wrap gap-2" aria-label="Review type filters">{[['all', 'All'], ['progress-review', 'Progress Review'], ['mcr', 'Monthly Coaching Meeting'], ['review', 'Review']].map(([id, label]) =>
          <button className="rounded-full border px-3 py-1.5 text-xs aria-pressed:bg-primary-600 aria-pressed:text-white" key={id} type="button" aria-pressed={type === id} onClick={() => setType(id)}>{label}</button>)}</div>
        <div className="flex gap-2" aria-label="Review status filters">{[['all', 'All statuses'], ['completed', 'Completed'], ['upcoming', 'Upcoming']].map(([id, label]) =>
          <button className="rounded-full border px-3 py-1.5 text-xs aria-pressed:bg-primary-600 aria-pressed:text-white" key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}</div>
      </div>
      {reviewsState.loading ? <div aria-label="Loading reviews"><RowsSkeleton rows={5} avatar={false} /></div> : reviewsState.error ? null : !rows.length
        ? <p>No reviews found for this learner.</p> : !visible.length ? <p>No reviews match this filter.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead><tr>
          {['Review Type', 'Planned Date', 'Scheduled Date & Time', 'Completed Date', 'Status', 'Reviewer', 'Actions'].map(label => <th className="px-3 py-3" key={label}>{label}</th>)}
        </tr></thead><tbody>{visible.map(row => <tr className="border-b border-foreground-100" key={row.id}>
          <td className="px-3 py-3 font-semibold">{row.title}</td><td className="px-3 py-3">{reviewDate(row.plannedDate)}</td>
          <td className="px-3 py-3" aria-label={row.scheduledDate ? `${reviewDate(row.scheduledDate)} at ${row.scheduledTime || '--'}` : 'Not scheduled'}>
            <span className="block">{reviewDate(row.scheduledDate)}</span>{row.scheduledDate && <span>{row.scheduledTime || '--'}</span>}</td>
          <td className="px-3 py-3">{reviewDate(row.completedDate)}</td><td className="px-3 py-3"><StatusBadge status={row.status} label={statusLabel(row.status)} size="sm" /></td><td className="px-3 py-3">{row.reviewer}</td>
          <td className="px-3 py-3"><button type="button" onClick={() => navigate(`/coach/reviews/${encodeURIComponent(row.id)}`, {
            state: { returnTo: `${location.pathname}${location.search}` },
          })}>View</button></td>
        </tr>)}</tbody></table></div>}
    </ReferencePanel>
  </div>;
}

function reviewGenerationIssueMessage(code: string) {
  if (code === 'missing_learner_start_date') {
    return 'Future reviews and monthly coaching meetings cannot be generated because the learner start date is missing. Existing scheduled records may still appear below.';
  }
  if (code === 'invalid_learner_start_date') {
    return 'Future reviews and monthly coaching meetings cannot be generated because the learner start date is invalid.';
  }
  if (code === 'missing_learner_enrolment') {
    return 'Future reviews and monthly coaching meetings cannot be generated because this learner is not linked to an enrolment record.';
  }
  if (code === 'missing_curriculum_programme') {
    return 'Review scheduling is unavailable because this learner is not linked to a Curriculum programme.';
  }
  if (code === 'no_enabled_review_templates') {
    return 'No enabled Review templates are configured for this learner\'s Curriculum programme.';
  }
  return 'The review schedule could not be generated for this learner. Check their enrolment and Curriculum configuration.';
}
