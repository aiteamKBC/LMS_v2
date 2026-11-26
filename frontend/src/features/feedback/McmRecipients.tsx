import { useEffect, useId, useState } from 'react';
import { feedbackApi, type FeedbackCoachRecipients } from '@/api/feedback';
import { AppIcon } from '@/components/feature/AppIcon';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import styles from './McmRecipients.module.css';
import { McmDailyAssignments } from './McmDailyAssignments';

const plural = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;
const reviewDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
}).format(new Date(value)) : 'Date not recorded';

export function McmRecipients({ formId }: { formId: number }) {
  const [view, setView] = useState<'coach' | 'day'>('coach');
  return <div className={styles.root}>
    <div className={styles.viewSwitch} role="group" aria-label="MCM assignment view">
      <button type="button" aria-pressed={view === 'coach'} onClick={() => setView('coach')}>By coach</button>
      <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>Daily assignments</button>
    </div>
    {view === 'coach' ? <CoachRecipients formId={formId} /> : <McmDailyAssignments formId={formId} />}
  </div>;
}

function CoachRecipients({ formId }: { formId: number }) {
  const prefix = useId();
  const [search, setSearch] = useState('');
  const [coach, setCoach] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<FeedbackCoachRecipients | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      feedbackApi.recipientsByCoach(formId, search, coach, page).then(result => {
        if (active) setData(result);
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load assigned learners.');
      }).finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [formId, search, coach, page, revision]);

  return <section className={styles.root} aria-label="MCM learners by current coach">
    <p className={styles.intro}>Grouped by each learner’s current coach. Open a coach, then a learner to see their reviews.</p>
    <div className={styles.toolbar}>
      <label className={styles.search}><span>Find a coach or learner</span><input type="search" value={search}
        placeholder="Search name, email or programme…" onChange={event => { setSearch(event.target.value); setCoach(''); setPage(1); setData(null); }} /></label>
      <button type="button" className={styles.refresh} disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    {error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {loading && !data ? <LoadingSkeleton label="Loading coaches and learners…" variant="rows" /> : data && <>
      {!data.coaches.length && !error && <p role="status" className={styles.empty}>{search ? 'No coaches or learners match your search.' : 'No MCM feedback assignments yet.'}</p>}
      <div className={styles.groups}>
        {data.coaches.map((group, index) => {
          const expanded = group.key === coach;
          const panelId = `${prefix}-coach-${index}`;
          return <div className={styles.group} key={group.key}>
            <button type="button" className={styles.coach} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
              onClick={() => { setCoach(expanded ? '' : group.key); setPage(1); }}>
              <span className={styles.avatar} aria-hidden="true"><AppIcon name="ri-user-star-line" /></span>
              <span className={styles.identity}><strong>{group.name}</strong><span>{group.email || (group.key === 'unlinked' ? 'Coach name recorded, but no linked email' : 'No current coach on the learner record')}</span></span>
              <span className={styles.counts}><span>{plural(group.learnerCount, 'student')} · {plural(group.reviewCount, 'review')}</span><span><b>{group.completedCount} completed</b> · {group.remainingCount} awaiting response</span></span>
              <AppIcon className={styles.chevron} name={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </button>
            {expanded && <div id={panelId} className={styles.learners} role="region" aria-label={`${group.name} learners`} aria-busy={loading}>
              {error ? null : loading || data.coachKey !== coach ? <LoadingSkeleton label="Loading this coach’s learners…" variant="rows" /> : <>
                <p className={styles.pageHint}>Showing {data.learners.length ? (data.page - 1) * data.pageSize + 1 : 0}–{Math.min(data.page * data.pageSize, group.learnerCount)} of {plural(group.learnerCount, 'student')} · All dates in UK time</p>
                {data.learners.map(learner => <details className={styles.learner} key={`${search}-${coach}-${data.page}-${learner.learnerId}`}>
                  <summary>
                    <span className={styles.identity}><strong>{learner.learnerName}</strong><span>{learner.programme || 'Programme not recorded'}</span><span>{learner.email}</span>{group.key === 'unlinked' && <span>Coach: {learner.coachName}</span>}</span>
                    <span className={styles.counts}><span>{plural(learner.reviewCount, 'review')}</span><span>{learner.completedCount} completed · {learner.remainingCount} awaiting response</span></span>
                    <AppIcon className={styles.chevron} name="ri-arrow-down-s-line" />
                  </summary>
                  <ul className={styles.reviews} aria-label={`${learner.learnerName} reviews`}>
                    {learner.reviews.map(review => <li key={review.key}>
                      <div className={styles.identity}><strong>{review.sourceTitle || 'Monthly coaching review'}</strong><span>Review completed: {reviewDate(review.sourceStartsAt)}</span><span>Feedback assigned: {reviewDate(review.assignedAt)} · Form v{review.formVersion}</span></div>
                      <span className={styles.status} data-status={review.responseStatus}>{review.responseStatus === 'completed' ? 'Completed' : review.responseStatus === 'in_progress' ? 'In progress' : review.responseStatus === 'not_started' ? 'Not started' : review.responseStatus.replaceAll('_', ' ')}</span>
                    </li>)}
                  </ul>
                </details>)}
                {data.pages > 1 && <nav aria-label="Learner pages" className={styles.pagination}>
                  <button type="button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button><span>Page {data.page} of {data.pages}</span><button type="button" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</button>
                </nav>}
              </>}
            </div>}
          </div>;
        })}
      </div>
    </>}
  </section>;
}
