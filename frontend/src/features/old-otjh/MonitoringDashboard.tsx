import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { getMonitoring } from './monitoringApi';
import type { MonitoredLearner } from './monitoringApi';
import { RecordBadge, RecordProgress } from './RecordDesign';
import { displayDate, monthLabel } from './report';
import design from './design.module.css';
import styles from './monitoring.module.css';

const number = (value: number) => value.toLocaleString('en-GB');
const statuses: Record<string, string> = {
  all: 'All review states', completed: 'Review complete', not_started: 'Not started',
  learner_outstanding: 'Learner signature outstanding', coach_outstanding: 'Coach signature outstanding',
  learner_signed: 'Learner signed all months', coach_signed: 'Coach signed all months',
  awaiting_both: 'Both signatures outstanding', awaiting_learner: 'Awaiting learner', awaiting_coach: 'Awaiting coach',
  ready_to_complete: 'Awaiting month completion', pending_revisions: 'Pending revisions',
  needs_attention: 'Needs attention', no_data: 'No report months', link_issue: 'Identity link needs review',
};
const metrics = [
  { key: 'total_learners', filter: 'all', label: 'Active learners', icon: 'ri-group-line', note: 'Linked to enrolment' },
  { key: 'completed', filter: 'completed', label: 'Review complete', icon: 'ri-checkbox-circle-line', note: 'All required months completed' },
  { key: 'learner_outstanding', filter: 'learner_outstanding', label: 'Awaiting learner', icon: 'ri-quill-pen-line', note: 'At least one unsigned month' },
  { key: 'coach_outstanding', filter: 'coach_outstanding', label: 'Awaiting coach', icon: 'ri-user-star-line', note: 'At least one unsigned month' },
  { key: 'not_started', filter: 'not_started', label: 'Not started', icon: 'ri-time-line', note: 'Report months available' },
  { key: 'needs_attention', filter: 'needs_attention', label: 'Needs attention', icon: 'ri-alert-line', note: 'Links, empty months or revisions' },
];

export function MonitoringDashboard() {
  const { auth } = useAuth();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '';
  const [draft, setDraft] = useState(search);
  const [allMonths, setAllMonths] = useState(false);
  const [allCoaches, setAllCoaches] = useState(false);
  useEffect(() => { setDraft(search); }, [search]);
  useEffect(() => {
    if (draft === search) return;
    const timer = window.setTimeout(() => {
      setParams(current => { const next = new URLSearchParams(current); next.set('search', draft); next.delete('page'); return next; }, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, search, setParams]);
  const filters = { page: Math.max(1, Number(params.get('page')) || 1), search,
    status: params.get('status') || 'all', coach: params.has('coach') ? params.get('coach')! : undefined,
    programme: params.get('programme') || '' };
  const query = useQuery({ queryKey: ['old-otjh', auth.account?.id, 'monitor', filters],
    queryFn: ({ signal }) => getMonitoring(filters, signal), refetchInterval: 15000,
    placeholderData: previous => previous });
  const setFilter = (key: string, value?: string) => setParams(current => {
    const next = new URLSearchParams(current);
    if (value === undefined) next.delete(key); else next.set(key, value);
    if (key !== 'page') next.delete('page');
    return next;
  });
  const clearFilters = () => { setDraft(''); setParams({}); };
  const data = query.data;
  const stats = data?.stats;
  const percent = stats?.total_months ? Math.round(stats.completed_months / stats.total_months * 100) : 0;
  const hasFilters = Boolean(search || filters.status !== 'all' || filters.coach !== undefined || filters.programme);
  return <div className={styles.dashboard}>
    <header className={`${design.hero} ${styles.hero}`}>
      <div><p className={design.eyebrow}>KBC · Previous learning records</p>
        <h1 className="mt-3">Every learner. Every sign-off.</h1>
        <p className={`${design.heroCopy} mt-3`}>Track monthly reviews, see whose signature is needed, and open the learning behind every record.</p>
        <div className={styles.heroMeta}><span><AppIcon className="ri-eye-line" />Read-only monitoring</span><span><AppIcon className="ri-calendar-line" />Records through August 2026</span></div>
      </div>
      <div className={design.ringPanel}>
        <div className={design.ring} style={{ background: `conic-gradient(#dbc285 ${percent * 3.6}deg, #ffffff26 0deg)` }} aria-hidden="true"><span>{percent}%</span></div>
        <div><strong>{stats ? number(stats.completed_months) : '—'} / {stats ? number(stats.total_months) : '—'}</strong><p className="mt-1 text-xs">required months complete</p></div>
      </div>
    </header>
    <div className={styles.toolbar}><div><RecordBadge tone="positive"><AppIcon className="ri-refresh-line" />Live source records</RecordBadge>
      <p className={styles.muted}>Active in the previous audit and linked to enrolment. Totals below cover the whole cohort.</p></div>
      <button className={design.secondaryButton} disabled={query.isFetching} onClick={() => void query.refetch()}><AppIcon className="ri-refresh-line" />{query.isFetching ? 'Updating…' : 'Refresh'}</button></div>
    {query.error && <div role="alert" className={styles.error}>{data ? 'The last refresh failed. Showing the last successful figures. ' : ''}{query.error.message}
      <button className={design.secondaryButton} onClick={() => void query.refetch()}>Try again</button></div>}
    <section className={styles.metrics} aria-label="Cohort statistics">
      {metrics.map(metric => <button key={metric.key} className={`${design.card} ${styles.metric} ${filters.status === metric.filter ? styles.selected : ''}`}
        aria-pressed={filters.status === metric.filter} onClick={() => setFilter('status', metric.filter)}>
        <span className={styles.metricTop}><span>{metric.label}</span><AppIcon className={metric.icon} /></span>
        <strong>{stats ? number(stats[metric.key]) : '—'}</strong><small>{metric.note}</small>
      </button>)}
    </section>
    {stats && <div className={styles.strip} aria-label="Month and signature totals">
      <span><strong>{number(stats.remaining_months)}</strong> months remaining</span>
      <button onClick={() => setFilter('status', 'learner_signed')}><strong>{number(stats.learner_signed)}</strong> learners signed all months</button>
      <button onClick={() => setFilter('status', 'coach_signed')}><strong>{number(stats.coach_signed)}</strong> learners with all coach signatures</button>
      <button onClick={() => setFilter('status', 'ready_to_complete')}><strong>{number(stats.ready_to_complete)}</strong> learners awaiting completion</button>
      <span><strong>{number(stats.activity_count)}</strong> recorded activities</span>
      <button onClick={() => setFilter('status', 'pending_revisions')}><strong>{number(stats.pending_revisions)}</strong> pending revisions</button>
    </div>}
    {data && <section className={styles.insights} aria-label="Review breakdown">
      <div className={`${design.card} ${styles.insight}`}><div className={styles.sectionTitle}><div><h2>Month by month</h2><p>Signed records / learners required to review each month</p></div><AppIcon className="ri-calendar-check-line" /></div>
        <div className={styles.legend}><span><i className={styles.learnerDot} />Learner</span><span><i className={styles.coachDot} />Coach</span><span><i className={styles.completeDot} />Complete</span></div>
        {!data.monthly.length && <p className={styles.muted}>No report months yet.</p>}
        <div className={styles.months}>{(allMonths ? data.monthly : data.monthly.slice(-5)).map(month => <div key={month.month} className={styles.month}>
          <strong>{monthLabel(month.month)}</strong><div className={styles.bars}>
            {(['learner_signed', 'coach_signed', 'complete'] as const).map((key, index) => <div key={key} className={styles.barLine}>
              <span className="sr-only">{['Learner signatures', 'Coach signatures', 'Completed reviews'][index]}</span>
              <div className={styles.bar}><i className={[styles.learnerBar, styles.coachBar, styles.completeBar][index]} style={{ width: `${month.total ? month[key] / month.total * 100 : 0}%` }} /></div><span>{month[key]}/{month.total}</span>
            </div>)}
          </div></div>)}</div>
        {data.monthly.length > 5 && <button className={styles.textButton} onClick={() => setAllMonths(!allMonths)}>{allMonths ? 'Show latest 5 months' : `View all ${data.monthly.length} months`}<AppIcon className={allMonths ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></button>}
      </div>
      <div className={`${design.card} ${styles.insight}`}><div className={styles.sectionTitle}><div><h2>Coach follow-up</h2><p>Outstanding coach signatures, counted by month</p></div><AppIcon className="ri-user-star-line" /></div>
        <div className={styles.coaches}>{[...data.coaches].sort((a, b) => b.outstanding_signatures - a.outstanding_signatures).slice(0, allCoaches ? undefined : 5).map(coach =>
          <button key={coach.key} className={styles.coach} onClick={() => setFilter('coach', coach.key)} aria-label={`Filter by coach ${coach.name}`}>
            <span className={styles.avatar}>{coach.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span>
            <span><strong>{coach.name}</strong><small>{coach.learners} learners · {coach.completed} reviews complete</small></span>
            <span className={styles.coachCount}><strong>{number(coach.outstanding_signatures)}</strong><small>to sign</small></span><AppIcon className="ri-arrow-right-s-line" />
          </button>)}</div>
        {data.coaches.length > 5 && <button className={styles.textButton} onClick={() => setAllCoaches(!allCoaches)}>{allCoaches ? 'Show top 5 coaches' : `View all ${data.coaches.length} coaches`}<AppIcon className="ri-arrow-down-s-line" /></button>}
      </div>
    </section>}
    <section className={`${design.card} ${styles.directory}`} aria-label="Learner directory">
      <div className={styles.directoryHeading}><div><h2>Learner records</h2><p>Find a learner and open their monthly attendance, activities, assignments and signatures.</p></div>
        <RecordBadge>{data ? number(data.total) : '…'} learners{hasFilters ? ' matched' : ''}</RecordBadge></div>
      <div className={styles.filters}>
        <label className={styles.search}><span>Search learners</span><div><AppIcon className="ri-search-line" /><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Name, email or Aptem ID" /></div></label>
        <label><span>Review state</span><select value={filters.status} onChange={event => setFilter('status', event.target.value)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Coach</span><select value={filters.coach === undefined ? '__all__' : filters.coach} onChange={event => setFilter('coach', event.target.value === '__all__' ? undefined : event.target.value)}><option value="__all__">All coaches</option>{data?.coaches.map(coach => <option key={coach.key} value={coach.key}>{coach.name}</option>)}</select></label>
        <label><span>Programme</span><select value={filters.programme} onChange={event => setFilter('programme', event.target.value)}><option value="">All programmes</option>{data?.programmes.map(programme => <option key={programme}>{programme}</option>)}</select></label>
      </div>
      <div className={styles.filterNote}><span>Signature counts are for required months. Both roles may still need to sign for the same learner.</span>{hasFilters && <button className={styles.textButton} onClick={clearFilters}>Clear filters</button>}</div>
      {query.isPending && <div role="status" className={styles.loading}>Loading learner records…</div>}
      {data && <div className={styles.tableWrap} aria-busy={query.isFetching}><table className={styles.table} aria-label="Active learner records">
        <thead><tr>{['Learner', 'Coach', 'Review progress', 'Learner signed', 'Coach signed', 'Review state', ''].map((label, index) => <th key={index} scope="col">{label || <span className="sr-only">Open record</span>}</th>)}</tr></thead>
        <tbody>{data.learners.map(learner => <LearnerRow key={learner.enrolment_id} learner={learner} />)}</tbody>
      </table></div>}
      {data?.learners.length === 0 && <EmptyState title={hasFilters ? 'No learners match these filters' : 'No active enrolled learners found'} description={hasFilters ? 'Try another name or clear the filters.' : 'Learners appear when an active previous audit record is linked to enrolment.'} action={hasFilters ? <button className={design.secondaryButton} onClick={clearFilters}>Clear filters</button> : undefined} />}
      {data && <footer className={styles.pagination}><span>{data.total ? `${(data.page - 1) * data.page_size + 1}–${Math.min(data.page * data.page_size, data.total)}` : '0'} of {number(data.total)} learners</span>
        <div><button className={design.secondaryButton} disabled={data.page <= 1 || query.isFetching} onClick={() => setFilter('page', String(data.page - 1))}>Previous</button><span>Page {data.page} of {data.pages}</span><button className={design.secondaryButton} disabled={data.page >= data.pages || query.isFetching} onClick={() => setFilter('page', String(data.page + 1))}>Next</button></div></footer>}
    </section>
    <p className={styles.footnote}>Refreshes every 15 seconds while this tab is active.{data && ` Last updated ${new Date(data.updated_at).toLocaleTimeString('en-GB')}.`} Content availability is checked when you open a month.</p>
  </div>;
}

function LearnerRow({ learner: row }: { learner: MonitoredLearner }) {
  return <tr><td data-label="Learner"><div className={styles.learnerName}>{row.name || 'Unnamed learner'}</div><div className={styles.email}>{row.email || 'No email recorded'}</div>
    <small>{row.programme || 'No programme recorded'}</small><div className={styles.sourceStates}><span>Aptem {row.id}</span><span>Enrolment: {row.enrolment_status || 'Unset'}</span></div></td>
    <td data-label="Coach"><span>{row.coach_name || 'Unassigned'}</span></td>
    <td data-label="Review progress"><strong>{row.completed_months} / {row.total_months} months</strong><RecordProgress completed={row.completed_months} total={row.total_months} /><small>{row.remaining_months} remaining · {number(row.activity_count)} activities</small>{row.additional_months > 0 && <small>{row.additional_months} additional source months</small>}</td>
    <td data-label="Learner signed"><SignatureCount count={row.learner_signed_months} total={row.total_months} /></td>
    <td data-label="Coach signed"><SignatureCount count={row.coach_signed_months} total={row.total_months} /></td>
    <td data-label="Review state"><RecordBadge tone={row.can_access_lms ? 'positive' : 'pending'}>{statuses[row.status] || row.status}</RecordBadge>
      {!!row.pending_revisions && <small>{row.pending_revisions} pending revisions</small>}{row.last_signed_at && <small>Last signature {displayDate(row.last_signed_at)}</small>}</td>
    <td data-label="Open record">{row.can_open ? <Link className={design.secondaryButton} to={`/old-otjh/coach/${row.id}`} aria-label={`Open record for ${row.name}`}>Open<AppIcon className="ri-arrow-right-line" /></Link> : <span className={styles.muted}>Check identity link</span>}</td></tr>;
}

function SignatureCount({ count, total }: { count: number; total: number }) {
  return <div className={styles.signatureCount}><RecordBadge tone={total && count === total ? 'positive' : count ? 'brand' : 'neutral'}>{total ? `${count} / ${total}` : 'No months'}</RecordBadge><small>{total ? count === total ? 'All signed' : `${total - count} unsigned` : 'Not available'}</small></div>;
}
