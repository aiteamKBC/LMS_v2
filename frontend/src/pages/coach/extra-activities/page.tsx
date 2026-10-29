import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ExtraActivityInfo } from '@/components/feature/ExtraActivityInfo';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { readExtraActivities, readExtraLearners, type CoachExtraActivity, type ExtraLearner } from './api';
import styles from './extraActivities.module.css';

const labels: Record<string, string> = { submitted_for_tutor_review: 'Awaiting review', accepted: 'Accepted', partial: 'Partially accepted', rejected: 'Referred back', referred: 'Changes requested', escalated: 'Escalated' };
export default function CoachExtraActivitiesPage() {
  const coach = useCoachIdentity();
  const nav = roleNavMap.coach;
  const [learners, setLearners] = useState<ExtraLearner[]>([]);
  const [rows, setRows] = useState<CoachExtraActivity[]>([]);
  const [learner, setLearner] = useState('');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { setLearner(''); setPage(1); }, [coach.email]);
  useEffect(() => {
    if (!coach.isInitialized || !coach.email) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setRows([]); setLearners([]);
    const query = new URLSearchParams({ status, page: String(page), ...(learner ? { learner } : {}), ...(month ? { month } : {}) });
    void Promise.all([readExtraActivities(query, controller.signal), readExtraLearners(controller.signal)])
      .then(([data, people]) => { if (!controller.signal.aborted) { setRows(data.items); setHasNext(data.hasNext); setLearners(people); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load extra activities.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [coach.email, coach.isInitialized, learner, month, status, page, version]);
  return <WorkspaceShell role="coach" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Extra activities" pageSubtitle="Review and approve additional learning submitted by your learners" userName={coach.name} userRole="Progress Coach">
    <main className={styles.page}>
      <header><h1>Extra activities</h1><ExtraActivityInfo /><p>Review your learners’ additional work activities and relevant external training.</p></header>
      {!coach.email && coach.isInitialized && <p role="alert">Choose an authorised coach workspace to continue.</p>}
        <section className={styles.panel} aria-label="Extra activity filters"><div className={styles.filters}>
          <label>Learner<select value={learner} onChange={e => { setLearner(e.target.value); setPage(1); }}><option value="">All my learners</option>{learners.map(person => <option key={`${person.kind}:${person.id}`} value={String(person.id)}>{person.name} · {person.programme}</option>)}</select></label>
          <label>Activity month<input type="month" value={month} onChange={e => { setMonth(e.target.value); setPage(1); }} /></label>
          <label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="pending">Awaiting review</option><option value="accepted">Accepted</option><option value="referred">Referred back</option></select></label>
        </div><p>Learners add their own activities and evidence. Select an activity below to review it and record your decision.</p></section>
        {error && <div role="alert">{error} <button type="button" onClick={() => setVersion(v => v + 1)}>Retry activities</button></div>}
        {loading && coach.email && <p role="status">Loading extra activities...</p>}
        {!loading && !error && coach.email && !rows.length && <p>No extra activities match these filters.</p>}
        {!loading && !error && rows.map(row => <article className={styles.panel} key={row.id}>
          <div className={styles.actions}><span className={styles.badge}>Extra activity</span><span>{labels[row.status] || row.status}</span></div>
          <h2>{row.title}</h2><p>{row.learner} · {row.month} · {row.hours || '0'} hours</p>
          {row.addedBy && <p>Added by: {row.addedBy}</p>}{row.reviewedBy && <p>Reviewed by: {row.reviewedBy}</p>}
          <Link to={`/coach/extra-activities/${row.id}`}>View and review activity</Link>
        </article>)}
        {!loading && !error && <nav aria-label="Activity pages" className={styles.actions}><button type="button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={!hasNext} onClick={() => setPage(v => v + 1)}>Next</button></nav>}
    </main>
  </WorkspaceShell>;
}
