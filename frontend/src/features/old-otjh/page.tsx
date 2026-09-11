import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { coachNavItems } from '@/mocks/navigation';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { Panel } from '@/components/ui/Panel';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { inputClass } from '@/pages/users/components/ui';
import { useRecordSummary } from './useRecordSummary';
import { TransitionDialog } from './TransitionDialog';
import { MonthReport } from './MonthReport';
import { MonthListSkeleton } from './RecordSkeletons';
import { BulkSignDialog } from './BulkSignDialog';
import { MonitoringDashboard } from './MonitoringDashboard';
import { monthLabel, hours, duration, nextOutstanding } from './report';
import { getLearners, refreshMonths, type Summary } from './api';
import { MonthBadge, RecordBadge, RecordProgress, SignatureChip } from './RecordDesign';
import styles from './design.module.css';
import journal from './journal.module.css';
import shell from './shell.module.css';

const btnPrimary = styles.primaryButton;
const btnSecondary = styles.secondaryButton;


function Shell({ children }: { children: ReactNode }) {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { aptemId, month } = useParams<{ aptemId: string; month: string }>();
  const student = auth.account?.role === 'learner';
  const monitor = auth.account?.access === 'record-monitor';
  const backFallback = month ? (aptemId ? `/old-otjh/coach/${aptemId}/months` : '/old-otjh/months')
    : student ? '/old-otjh' : monitor ? '/old-otjh/monitor' : aptemId ? '/old-otjh/coach' : '/workspace/coach';
  if (student) return <div className={`${styles.scope} ${shell.shell}`}>
    <header className={shell.header}>
      <Link to="/old-otjh" className={shell.brand} aria-label="My learning">
        <img src="/assets/kbc-logo.png" alt="Kent Business College" className={shell.logo} />
        <div className={shell.brandText}>
          <p>Training &amp; Development Reports</p>
          <span>Monthly Activity Logs</span>
        </div>
      </Link>
      <nav className={shell.actions} aria-label="Account actions">
        <span className={shell.college}>Kent Business College</span>
        <button type="button" onClick={logout} className={`${shell.button} ${shell.logout}`}><AppIcon className="ri-logout-box-r-line" />Log out</button>
      </nav>
    </header>
    <main className={shell.main}>
      <PageContainer className={`${styles.page} ${shell.content} ${month ? journal.canvas : location.pathname.replace(/\/$/, '') === '/old-otjh/months' ? shell.monthsCanvas : ''}`}>
        {(month || location.pathname !== '/old-otjh') && <button type="button" className={shell.backButton} onClick={() => navigate(backFallback)}><AppIcon className="ri-arrow-left-line" />Back</button>}
        {children}
      </PageContainer>
    </main>
  </div>;
  return <WorkspaceShell role="coach" roleLabel={monitor ? 'Record monitor' : 'Coach'}
    showBackButton backFallbackHref={backFallback}
    pageTitle="Previous learning record" filterLearnerNavigation={false} navItems={monitor ? [
      { id: 'record-monitor', label: 'Record monitoring', href: '/old-otjh/monitor', icon: 'ri-dashboard-line' },
    ] : coachNavItems.map(item => item.id === 'coach-previous-records' ? {
        ...item,
        href: '',
        children: [
          { id: 'previous-records-list', label: 'Learning records', href: '/old-otjh/coach', icon: 'ri-history-line' },
          ...(auth.account?.access === 'super-admin' ? [{ id: 'record-monitor', label: 'Record monitoring', href: '/old-otjh/monitor', icon: 'ri-dashboard-line' }] : []),
        ],
      } : item)}><PageContainer className={`${styles.scope} ${styles.page} ${month ? journal.canvas : ''}`}>{children}</PageContainer></WorkspaceShell>;
}

function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return <Panel><EmptyState variant="error" title="Unable to load the previous record" description={error.message}
    action={<button className={btnSecondary} onClick={retry}>Try again</button>} /></Panel>;
}

export function Progress({ summary }: { summary: Summary }) {
  const total = summary.total_months || 0;
  const complete = summary.completed_months || 0;
  return <section className={`${styles.card} ${styles.summary}`} aria-labelledby="transition-summary-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="transition-summary-heading" className="text-base font-heading font-semibold">Your transition summary</h2>
      <RecordBadge tone={summary.can_access_lms ? 'positive' : 'brand'}>{summary.can_access_lms ? 'Review complete' : 'Review in progress'}</RecordBadge>
    </div>
    <dl className={`${styles.facts} mt-4`}>{[
      ['Learner', summary.learner?.name], ['Programme', summary.learner?.programme],
      ['Assigned coach', summary.learner?.coach_name], ['Months completed', `${complete} of ${total}`],
    ].map(([label, value]) => <div className={styles.fact} key={label}><dt className={styles.eyebrow}>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
    <div className="mt-5 space-y-2"><div className="flex items-center justify-between gap-2 text-xs text-foreground-500">
      <span>{complete} of {total} months complete</span><span>{total ? Math.round(complete / total * 100) : 0}%</span></div>
      <RecordProgress completed={complete} total={total} />
      <p className="pt-1 text-[13px]">{summary.can_access_lms ? 'Your record is complete. LMS access is available.' : `${Math.max(0, total - complete)} months remaining`}</p>
      <p className="text-[11px] text-foreground-500">Previous record through 31 August 2026</p>
    </div>
  </section>;
}

function Welcome({ summary }: { summary?: Summary }) {
  const total = summary?.total_months ?? 0;
  const firstName = summary?.learner?.name?.trim().split(/\s+/)[0];
  return <section className={styles.hero} aria-label="My learning"><div className={styles.heroLayout}>
    <div><p className={styles.eyebrow}>Welcome to your learning area</p>
      <h1 className="mt-3 font-heading">Welcome back<span className={styles.heroAccent}>{firstName ? `, ${firstName}.` : '.'}</span></h1>
      <p className={`${styles.heroCopy} mt-3`}>{summary?.can_access_lms ? 'Your previous learning record is complete. You can continue to access your LMS or review your full monthly learning record below.' : 'Review your monthly records, sign them with your coach, and complete your transition to the new LMS.'}</p>
      <div className={styles.heroMeta}><div><AppIcon className="ri-graduation-cap-line" /><span><small>Programme</small><strong>{summary?.learner?.programme || '-'}</strong></span></div><div><AppIcon className="ri-team-line" /><span><small>Assigned coach</small><strong>{summary?.learner?.coach_name || 'Unassigned'}</strong></span></div></div>
    </div>
    {summary && <div className={`${styles.ringPanel} ${styles.heroMonthsPanel}`}><div className={styles.heroMonthsHeading}><p className={styles.ringTitle}>Full monthly learning record</p><RecordBadge tone="positive">{total} months</RecordBadge></div><p className={styles.heroMonthsPeriod}>Sep 2024 – Aug 2026</p><div className={styles.heroMonthGrid}>{summary.months.map(month => <span key={month.month}>{monthLabel(month.month).replace(' ', '\n')}</span>)}</div></div>}
  </div></section>;
}

function ProgrammeOverview({ summary }: { summary: Summary }) {
  return <section className={`${styles.card} ${styles.overviewCard}`}><h2>Programme overview</h2><p className={styles.overviewIntro}>Key information about your learning programme.</p><div className={styles.overviewGrid}><div><AppIcon className="ri-user-line" /><span><small>Learner</small><strong>{summary.learner?.name || '-'}</strong></span></div><div><AppIcon className="ri-book-open-line" /><span><small>Programme</small><strong>{summary.learner?.programme || '-'}</strong></span></div><div><AppIcon className="ri-team-line" /><span><small>Coach</small><strong>{summary.learner?.coach_name || 'Unassigned'}</strong></span></div><div><AppIcon className="ri-file-list-3-line" /><span><small>Record status</small><RecordBadge tone={summary.can_access_lms ? 'positive' : 'pending'}>{summary.can_access_lms ? 'Complete' : 'In progress'}</RecordBadge></span></div></div><div className={styles.statusBar}><div><AppIcon className="ri-checkbox-circle-fill" /><span><strong>All months signed</strong><small>Your monthly records are complete and signed.</small></span></div><div><AppIcon className="ri-checkbox-circle-fill" /><span><strong>{summary.can_access_lms ? 'Review complete' : 'Review in progress'}</strong><small>Your learning record has been reviewed.</small></span></div><div><AppIcon className="ri-checkbox-circle-fill" /><span><strong>{summary.can_access_lms ? 'LMS access available' : 'LMS access pending'}</strong><small>{summary.can_access_lms ? 'You can continue to access your learning plan.' : 'Complete your signatures to unlock access.'}</small></span></div></div></section>;
}
function Portal() {
  const lmsButton = useRef<HTMLButtonElement>(null);
  const query = useRecordSummary(undefined, true);
  const navigate = useNavigate();
  const location = useLocation();
  const [dialogOpen, setDialogOpen] = useState(Boolean((location.state as { contactCoach?: boolean } | null)?.contactCoach));
  const [checkError, setCheckError] = useState('');
  const [checking, setChecking] = useState(false);
  if (query.data && !query.error && !query.data.is_legacy) return <Navigate to="/workspace/learner" replace />;
  const enterLms = async () => {
    setChecking(true);
    setCheckError('');
    try {
      const result = await query.refetch();
      if (result.error) throw result.error;
      const fresh = result.data;
      if (!fresh) throw new Error('The record could not be loaded.');
      if (fresh.can_access_lms) navigate('/workspace/learner');
      else setDialogOpen(true);
    } catch (error) { setCheckError(error instanceof Error ? error.message : 'The record could not be loaded.'); setDialogOpen(true); }
    finally { setChecking(false); }
  };
  return <><Welcome summary={query.data} />
    <div className={styles.portalGrid}>
      <section className={`${styles.card} ${styles.lift} ${styles.portalCard} ${styles.lmsCard}`}>
        <div className={styles.cardTop}><span className={`${styles.iconTile} ${styles.iconSolid}`}><AppIcon className="ri-graduation-cap-line" /></span>
          <RecordBadge tone={query.data?.can_access_lms && !query.error ? 'positive' : query.data && !query.error ? 'pending' : 'neutral'}>
            <AppIcon className={query.data?.can_access_lms && !query.error ? 'ri-checkbox-circle-line' : 'ri-lock-line'} />
            {query.error ? 'Check unavailable' : !query.data ? 'Checking access' : query.data.can_access_lms ? 'Access available' : 'Access pending'}
          </RecordBadge></div>
        <h2 className="mt-1 text-lg font-heading font-semibold">Open your LMS</h2><p className="text-[13px] text-foreground-500">Continue to your learning plan, activities and progress.</p>
        <button ref={lmsButton} className={`${btnPrimary} mt-2`} disabled={checking || query.isPending || query.starting} onClick={() => void enterLms()}>{checking ? 'Checking…' : 'Open LMS'}<AppIcon className="ri-arrow-right-line" /></button>
      </section>
      <section className={`${styles.card} ${styles.lift} ${styles.portalCard} ${styles.recordsCard}`}>
        <div className={styles.cardTop}><span className={styles.iconTile}><AppIcon className="ri-book-open-line" /></span>
          {query.data && <RecordBadge>{query.data.completed_months ?? 0}/{query.data.total_months ?? 0} months</RecordBadge>}</div>
        <h2 className="mt-1 text-lg font-heading font-semibold">Full monthly learning record</h2><p className="text-[13px] text-foreground-500">Review all your months, accepted hours and signatures.</p>
        <p className={styles.recordPeriod}><AppIcon className="ri-calendar-line" />Sep 2024 – Aug 2026</p>
        {query.data?.months[0] && <Link aria-label="Review first month" className={`${btnSecondary} mt-2`} to={`/old-otjh/months/${query.data.months[0].month}`}>View first month<AppIcon className="ri-arrow-right-line" /></Link>}
      </section>
    </div>
    {dialogOpen && (query.data || checkError || query.error) && <TransitionDialog returnFocusRef={lmsButton} summary={query.data}
      error={checkError || query.error?.message} checking={checking} onClose={() => setDialogOpen(false)} onRetry={() => void enterLms()}
      onReview={() => { const next = nextOutstanding(query.data!); setDialogOpen(false); navigate(next ? `/old-otjh/months/${next}` : '/old-otjh/months'); }} />}
    {query.isPending ? <Panel><p role="status" className="text-sm text-foreground-500">Loading your previous record…</p></Panel>
      : query.error ? <ErrorState error={query.error} retry={query.retryStart} />
      : query.data && <ProgrammeOverview summary={query.data} />}
  </>;
}

function MonthList({ aptemId }: { aptemId?: number }) {
  const query = useRecordSummary(aptemId, true);
  const { auth } = useAuth();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete' | 'pending'>('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [collapsedYears, setCollapsedYears] = useState<string[]>([]);
  const refresh = useMutation({ mutationFn: () => refreshMonths(aptemId!, reason),
    onSuccess: () => { setReason(''); void client.invalidateQueries({ queryKey: ['old-otjh'] }); } });
  if (query.isPending || query.starting) return <MonthListSkeleton />;
  if (query.error) return <ErrorState error={query.error} retry={query.retryStart} />;
  if (!query.data?.is_legacy) return <EmptyState title="No previous record review is required" />;
  const base = aptemId === undefined ? '/old-otjh/months' : `/old-otjh/coach/${aptemId}/months`;
  const summary = query.data;
  const total = summary.total_months || 0;
  const complete = summary.completed_months || 0;
  const remaining = Math.max(0, total - complete);
  const percent = total ? Math.min(100, Math.max(0, Math.round(complete / total * 100))) : 0;
  const student = auth.account?.role === 'learner';
  const canBulkSign = auth.account?.access !== 'record-monitor' && (student || ['coach', 'super-admin'].includes(auth.account?.access || ''));
  const unsigned = summary.months.filter(item => item.is_required !== false && (student ? item.status !== 'complete' : !item.coach_signature));
  const years = Array.from(new Set(summary.months.map(item => item.month.slice(0, 4)))).sort();
  const filteredMonths = summary.months.filter(item => {
    const label = monthLabel(item.month).toLowerCase();
    return (!search.trim() || label.includes(search.trim().toLowerCase()))
      && (yearFilter === 'all' || item.month.startsWith(yearFilter))
      && (filter === 'all' || (filter === 'complete' ? item.status === 'complete' : item.status !== 'complete'));
  });
  const groupedMonths = years.map(year => ({ year, months: filteredMonths.filter(item => item.month.startsWith(year)) })).filter(group => group.months.length);
  const acceptedTotal = summary.months.reduce((sum, item) => sum + (Number(item.actual_hours) || 0), 0);
  return <div className={styles.monthList}>
    <header className={styles.monthListHeader}>
      <p className={styles.eyebrow}>Previous learning record</p>
      <h1 className="font-heading font-semibold">{aptemId === undefined ? 'Monthly learning records' : summary.learner?.name || 'Monthly learning records'}</h1>
      <p className={styles.programmeLine}>Full programme record <span>·</span> Sep 2024 – Aug 2026</p>
      <div className={styles.learnerMeta}>
        {summary.learner?.programme && <span>{summary.learner.programme}</span>}
        <span><AppIcon className="ri-user-line" />Coach: {summary.learner?.coach_name || 'Unassigned'}</span>
      </div>
    </header>
    <section className={styles.monthSummary} aria-labelledby="month-progress-heading">
      <div className={styles.monthSummaryCount}>
        <span className={styles.summaryIcon}><AppIcon className="ri-checkbox-circle-line" /></span>
        <div><p><strong>{complete}</strong><span> / {total}</span></p><span>Months completed</span></div>
      </div>
      <div className={styles.monthSummaryTrack}>
        <div className={styles.monthSummaryLine}>
          <h2 id="month-progress-heading">Review progress</h2>
          <RecordBadge tone={summary.can_access_lms ? 'positive' : 'brand'}>{summary.can_access_lms ? 'Review complete' : 'Review in progress'}</RecordBadge>
        </div>
        <RecordProgress completed={complete} total={total} />
        <div className={styles.monthSummaryCaption}>
          <span>{summary.can_access_lms ? 'Your record is complete. LMS access is available.' : `${remaining} ${remaining === 1 ? 'month' : 'months'} remaining`}</span><span>{percent}%</span>
        </div>
      </div>
      <div className={styles.monthCutoff}><AppIcon className="ri-calendar-line" /><div><span>Previous record through</span><strong>31 August 2026</strong></div></div>
    </section>
    <section className={styles.statStrip} aria-label="Record summary">
      <div><AppIcon className="ri-book-open-line" /><strong>{total}</strong><span>Months</span></div>
      <div><AppIcon className="ri-time-line" /><strong>{duration(acceptedTotal)}</strong><span>Accepted</span></div>
      <div><AppIcon className="ri-edit-line" /><strong>{complete}</strong><span>Signed</span></div>
      <div><AppIcon className="ri-checkbox-circle-line" /><strong>{percent}%</strong><span>Complete</span></div>
    </section>
    <section className={styles.monthFilters} aria-label="Filter learning records">
      <label><AppIcon className="ri-search-line" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search month (e.g. January)" aria-label="Search month" /></label>
      <div className={styles.filterPills}>{(['all', 'complete', 'pending'] as const).map(value => <button key={value} type="button" className={filter === value ? styles.activePill : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All months' : value === 'complete' ? 'Complete' : 'Needs signature'}</button>)}</div>
      <div className={styles.yearTabs}>{['all', ...years].map(value => <button key={value} type="button" className={yearFilter === value ? styles.activeYear : ''} onClick={() => setYearFilter(value)}>{value === 'all' ? 'All' : value}</button>)}</div>
    </section>
    {canBulkSign && <div className={styles.bulkActions}>
      <p>{unsigned.length ? `${unsigned.length} ${unsigned.length === 1 ? 'month' : 'months'} awaiting your sign-off. ${student ? 'Sign once to complete your previous learning record.' : 'Add the coach signature across the record.'}` : 'Your signature is saved for all months.'}</p>
      <button className={btnPrimary} disabled={!unsigned.length} onClick={() => setBulkOpen(true)}><AppIcon className="ri-edit-line" />Sign all months</button>
    </div>}
    {bulkMessage && <p role="status" className={styles.bulkSuccess}>{bulkMessage}</p>}
    {bulkOpen && <BulkSignDialog summary={summary} aptemId={aptemId} onClose={() => setBulkOpen(false)} onSaved={result => {
      client.setQueryData(['old-otjh', auth.account?.id, 'summary', aptemId ?? 'me'], result.summary);
      void client.invalidateQueries({ queryKey: ['old-otjh', auth.account?.id] });
      setBulkOpen(false); setBulkMessage(result.summary.can_access_lms
        ? 'All months are complete. Your signatures are saved and LMS access is open.'
        : `Your signature was saved for ${result.signed_months.length} ${result.signed_months.length === 1 ? 'month' : 'months'}. ${result.completed_months.length} completed automatically.${result.skipped_months.length ? ' Existing signatures were kept.' : ''}`);
    }} />}
    {query.data.months.length === 0 && <Panel><EmptyState title="No previous activity months are available" description="Please contact your coach to check your previous record." /></Panel>}
    <div className={styles.yearGroups}>{groupedMonths.map(group => <section key={group.year} className={styles.yearGroup}>
      <div className={styles.yearHeading}><div><strong>{group.year}</strong><span> · {group.months.length} months</span><small>{monthLabel(group.months[0].month)} – {monthLabel(group.months.at(-1)?.month)}</small></div><button type="button" onClick={() => setCollapsedYears(current => current.includes(group.year) ? current.filter(value => value !== group.year) : [...current, group.year])}>{collapsedYears.includes(group.year) ? 'Expand year' : 'Collapse year'} <AppIcon className={collapsedYears.includes(group.year) ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} /></button></div>
      {!collapsedYears.includes(group.year) && <div className={styles.monthGrid}>{group.months.map(month => <section key={month.month} className={`${styles.card} ${styles.lift} ${styles.monthCard} ${month.status === 'complete' ? styles.monthComplete : ''}`}>
      <div className={styles.monthCardHeading}>
        <span className={styles.monthNumber}>{summary.months.findIndex(item => item.month === month.month) + 1}</span>
        <span className={styles.monthIcon}><AppIcon className={month.status === 'complete' ? 'ri-calendar-check-line' : 'ri-calendar-line'} /></span>
        <h2 className="font-heading font-semibold">{monthLabel(month.month)}</h2>
        <span className={styles.activityCount}>{month.row_count} {month.row_count === 1 ? 'activity' : 'activities'}</span>
      </div>
      {month.is_required === false && <div><RecordBadge tone="neutral">Additional source month</RecordBadge></div>}
      <dl className={styles.monthHours}>
        <div><dt>Target hours</dt><dd>{month.training_plan_target == null ? '—' : `${hours(month.training_plan_target)} h`}</dd></div>
        <div><dt>Accepted hours</dt><dd>{duration(month.actual_hours)}</dd></div>
      </dl>
      <div className={styles.signatureChips}><SignatureChip signed={Boolean(month.student_signature)} label="Learner signature" /><SignatureChip signed={Boolean(month.coach_signature)} label="Coach signature" /></div>
      <div className={styles.monthCardFooter}><MonthBadge month={month} />
        <Link className={styles.monthReviewLink} to={`${base}/${month.month}`}>Review month<AppIcon className="ri-arrow-right-line" /></Link></div>
    </section>)}</div>}
    </section>)}</div>
    {query.data.can_access_lms && aptemId === undefined && <Link className={btnPrimary} to="/workspace/learner">Continue to new LMS</Link>}
    {auth.account?.access === 'super-admin' && aptemId !== undefined && <Panel className="space-y-3">
      <h2 className="font-semibold">Review months</h2><p className="text-sm text-foreground-500">New source months: {query.data.additional_source_months?.join(', ') || 'None'}</p>
      <input className={inputClass} aria-label="Reason for updating review months" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for updating the required months" />
      <button className={btnSecondary} disabled={reason.trim().length < 3 || refresh.isPending} onClick={() => refresh.mutate()}>Include new source months</button>
      {refresh.error && <p role="alert" className="text-sm text-red-600">{refresh.error.message}</p>}
    </Panel>}
  </div>;
}

function CoachList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // Debounced so typing does not fire a request per keystroke — the endpoint
  // filters server-side, which is what makes search work across every page
  // rather than only the 25 records on screen.
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  // A new search starts at page 1; staying on page 3 of the previous results
  // shows nothing and reads as "no matches".
  useEffect(() => { setPage(1); }, [applied]);

  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ['old-otjh', auth.account?.id, 'learners', page, applied],
    queryFn: () => getLearners(page, applied),
    // Keeps the previous page on screen while the next one loads, so the list
    // does not collapse to a skeleton on every keystroke.
    placeholderData: previous => previous,
  });

  const searchField = (
    <div className="relative">
      <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
      <input
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder="Search by name or email…"
        aria-label="Search previous learning records by learner name or email"
        className={`${inputClass} pl-9`}
      />
    </div>
  );

  if (query.isPending) return <><h1 className="text-2xl font-heading font-semibold">Previous learning records</h1>{searchField}
    <Panel><div role="status" aria-label="Loading learner records"><RowsSkeleton rows={5} avatar={false} /></div></Panel></>;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return <><h1 className="text-2xl font-heading font-semibold">Previous learning records</h1>
    {searchField}
    {!query.data?.learners.length && (
      applied
        ? <EmptyState title={`No record matches "${applied}"`} />
        : <EmptyState title="No previous records are assigned to you" />
    )}
    {query.data?.learners.map(learner => <Panel key={learner.id} className="flex flex-wrap items-center justify-between gap-3"><div>
      <h2 className="font-semibold">{learner.name}</h2><p className="text-sm text-foreground-500">{learner.programme}</p></div>
      <Link className={btnSecondary} to={`/old-otjh/coach/${learner.id}`}>Review record</Link></Panel>)}
    <div className="flex items-center gap-3"><button className={btnSecondary} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
      <span className="text-sm">Page {page}</span><button className={btnSecondary} disabled={page * (query.data?.page_size || 25) >= (query.data?.total || 0)} onClick={() => setPage(p => p + 1)}>Next</button></div>
  </>;
}

export default function OldOtjhPage() {
  const { auth } = useAuth();
  const { aptemId, month } = useParams<{ aptemId: string; month: string }>();
  const location = useLocation();
  const coachPath = location.pathname.startsWith('/old-otjh/coach');
  const student = auth.account?.role === 'learner';
  const monitor = auth.account?.access === 'record-monitor';
  if (student && location.pathname === '/old-otjh/months') return <Navigate to="/old-otjh" replace />;
  if (location.pathname === '/old-otjh/monitor') return <Shell><MonitoringDashboard /></Shell>;
  if (student && coachPath) return <Navigate to="/old-otjh" replace />;
  if (monitor && (!coachPath || !aptemId)) return <Navigate to="/old-otjh/monitor" replace />;
  if (!student && !coachPath) return <Navigate to="/old-otjh/coach" replace />;
  const selectedId = coachPath && aptemId ? Number(aptemId) : undefined;
  return <Shell>{monitor && <div className={styles.monitorToolbar}><Link to="/old-otjh/monitor" className={btnSecondary}><AppIcon className="ri-arrow-left-line" />All learners</Link><RecordBadge tone="brand">Read-only monitoring</RecordBadge></div>}{month ? <MonthReport key={`${selectedId}-${month}`} month={month} aptemId={selectedId} />
    : coachPath && !aptemId ? <CoachList />
    : coachPath || location.pathname.endsWith('/months') ? <MonthList aptemId={selectedId} /> : <Portal />}</Shell>;
}

