import { useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { PageSkeleton } from '@/components/feature/Skeletons';
import { Panel } from '@/components/ui/Panel';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { inputClass } from '@/pages/users/components/ui';
import { useRecordSummary } from './useRecordSummary';
import { TransitionDialog } from './TransitionDialog';
import { MonthReport } from './MonthReport';
import { BulkSignDialog } from './BulkSignDialog';
import { MonitoringDashboard } from './MonitoringDashboard';
import { monthLabel, hours, duration, nextOutstanding } from './report';
import { getLearners, refreshMonths, type Summary } from './api';
import { MonthBadge, RecordBadge, RecordProgress, SignatureChip } from './RecordDesign';
import styles from './design.module.css';

const btnPrimary = styles.primaryButton;
const btnSecondary = styles.secondaryButton;


function Shell({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { aptemId, month } = useParams<{ aptemId: string; month: string }>();
  const student = auth.account?.role === 'learner';
  const monitor = auth.account?.access === 'record-monitor';
  const backFallback = month ? (aptemId ? `/old-otjh/coach/${aptemId}/months` : '/old-otjh/months')
    : student ? '/old-otjh' : monitor ? '/old-otjh/monitor' : aptemId ? '/old-otjh/coach' : '/workspace/coach';
  return <WorkspaceShell role={student ? 'learner' : 'coach'} roleLabel={student ? 'Learner' : monitor ? 'Record monitor' : 'Coach'}
    showBackButton backFallbackHref={backFallback}
    pageTitle="Previous learning record" filterLearnerNavigation={false} navItems={student ? [
      { id: 'learner-overview', label: 'My learning', href: '/old-otjh', icon: 'ri-dashboard-line' },
      { id: 'previous-record', label: 'Previous learning record', href: '/old-otjh/months', icon: 'ri-history-line' },
    ] : monitor ? [
      { id: 'record-monitor', label: 'Record monitoring', href: '/old-otjh/monitor', icon: 'ri-dashboard-line' },
    ] : [
      { id: 'coach-overview', label: 'Coach workspace', href: '/workspace/coach', icon: 'ri-dashboard-line' },
      { id: 'previous-records', label: 'Previous learning records', href: '/old-otjh/coach', icon: 'ri-history-line' },
      ...(auth.account?.access === 'super-admin' ? [{ id: 'record-monitor', label: 'Record monitoring', href: '/old-otjh/monitor', icon: 'ri-dashboard-line' }] : []),
    ]}><PageContainer className={`${styles.scope} ${styles.page}`}>{children}</PageContainer></WorkspaceShell>;
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
  const complete = summary?.completed_months ?? 0;
  const total = summary?.total_months ?? 0;
  const percent = total ? Math.min(100, Math.max(0, Math.round(complete / total * 100))) : 0;
  const firstName = summary?.learner?.name?.trim().split(/\s+/)[0];
  return <section className={styles.hero} aria-label="My learning"><div className={styles.heroLayout}>
    <div><p className={styles.eyebrow}>Kent Business College · My learning</p>
      <h1 className="mt-3 font-heading">Welcome back{firstName ? `, ${firstName}` : ''}.</h1>
      <p className={`${styles.heroCopy} mt-3`}>{summary?.can_access_lms
        ? 'Your previous learning record is complete. Your next chapter in the LMS is ready.'
        : 'Review your monthly records, sign them with your coach, and complete your transition to the new LMS.'}</p>
    </div>
    {summary && <div className={styles.ringPanel}>
      <div className={styles.ring} aria-hidden="true" style={{ background: `conic-gradient(var(--record-gold) ${percent * 3.6}deg, rgba(255,255,255,.18) 0deg)` }}><span>{percent}%</span></div>
      <div className="text-[13px]"><p className="font-semibold">{complete} of {total} months</p><p className="mt-1 text-white/80">signed and completed</p></div>
    </div>}
  </div></section>;
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
      <section className={`${styles.card} ${styles.lift} ${styles.portalCard}`}>
        <div className={styles.cardTop}><span className={`${styles.iconTile} ${styles.iconSolid}`}><AppIcon className="ri-graduation-cap-line" /></span>
          <RecordBadge tone={query.data?.can_access_lms && !query.error ? 'positive' : query.data && !query.error ? 'pending' : 'neutral'}>
            <AppIcon className={query.data?.can_access_lms && !query.error ? 'ri-checkbox-circle-line' : 'ri-lock-line'} />
            {query.error ? 'Check unavailable' : !query.data ? 'Checking access' : query.data.can_access_lms ? 'Access available' : 'Access pending'}
          </RecordBadge></div>
        <h2 className="mt-1 text-lg font-heading font-semibold">LMS</h2><p className="text-[13px] text-foreground-500">Your learning plan, activities and progress.</p>
        <button ref={lmsButton} className={`${btnPrimary} mt-2`} disabled={checking || query.isPending || query.starting} onClick={() => void enterLms()}>{checking ? 'Checking…' : 'Open LMS'}<AppIcon className="ri-arrow-right-line" /></button>
      </section>
      <section className={`${styles.card} ${styles.lift} ${styles.portalCard}`}>
        <div className={styles.cardTop}><span className={styles.iconTile}><AppIcon className="ri-book-open-line" /></span>
          {query.data && <RecordBadge>{query.data.completed_months ?? 0}/{query.data.total_months ?? 0} months</RecordBadge>}</div>
        <h2 className="mt-1 text-lg font-heading font-semibold">Previous learning record</h2><p className="text-[13px] text-foreground-500">Review your monthly learning records and signatures.</p>
        <Link className={`${btnSecondary} mt-2`} to="/old-otjh/months">Review previous record<AppIcon className="ri-arrow-right-line" /></Link>
      </section>
    </div>
    {dialogOpen && (query.data || checkError || query.error) && <TransitionDialog returnFocusRef={lmsButton} summary={query.data}
      error={checkError || query.error?.message} checking={checking} onClose={() => setDialogOpen(false)} onRetry={() => void enterLms()}
      onReview={() => { const next = nextOutstanding(query.data!); setDialogOpen(false); navigate(next ? `/old-otjh/months/${next}` : '/old-otjh/months'); }} />}
    {query.isPending ? <Panel><p role="status" className="text-sm text-foreground-500">Loading your previous record…</p></Panel>
      : query.error ? <ErrorState error={query.error} retry={query.retryStart} />
      : query.data && <Progress summary={query.data} />}
  </>;
}

function MonthList({ aptemId }: { aptemId?: number }) {
  const query = useRecordSummary(aptemId, true);
  const { auth } = useAuth();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const refresh = useMutation({ mutationFn: () => refreshMonths(aptemId!, reason),
    onSuccess: () => { setReason(''); void client.invalidateQueries({ queryKey: ['old-otjh'] }); } });
  if (query.isPending || query.starting) return <PageSkeleton />;
  if (query.error) return <ErrorState error={query.error} retry={query.retryStart} />;
  if (!query.data?.is_legacy) return <EmptyState title="No previous record review is required" />;
  const base = aptemId === undefined ? '/old-otjh/months' : `/old-otjh/coach/${aptemId}/months`;
  const summary = query.data;
  const total = summary.total_months || 0;
  const complete = summary.completed_months || 0;
  const remaining = Math.max(0, total - complete);
  const percent = total ? Math.min(100, Math.max(0, Math.round(complete / total * 100))) : 0;
  const canBulkSign = auth.account?.role === 'learner' || ['coach', 'super-admin'].includes(auth.account?.access || '');
  const unsigned = summary.months.filter(item => item.is_required !== false && item.status !== 'complete');
  return <div className={styles.monthList}>
    <header className={styles.monthListHeader}>
      <p className={styles.eyebrow}>Previous learning record</p>
      <h1 className="font-heading font-semibold">{aptemId === undefined ? 'Monthly learning records' : summary.learner?.name || 'Monthly learning records'}</h1>
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
    {canBulkSign && <div className={styles.bulkActions}>
      <p>{unsigned.length ? `${unsigned.length} ${unsigned.length === 1 ? 'month' : 'months'} remaining. Sign once for your entire record.` : 'All months are complete.'}</p>
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
    <div className={styles.monthGrid}>{query.data.months.map(month => <section key={month.month} className={`${styles.card} ${styles.lift} ${styles.monthCard} ${month.status === 'complete' ? styles.monthComplete : ''}`}>
      <div className={styles.monthCardHeading}>
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
  const { auth } = useAuth();
  const query = useQuery({ queryKey: ['old-otjh', auth.account?.id, 'learners', page], queryFn: () => getLearners(page) });
  if (query.isPending) return <PageSkeleton />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return <><h1 className="text-2xl font-heading font-semibold">Previous learning records</h1>
    {!query.data?.learners.length && <EmptyState title="No previous records are assigned to you" />}
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
  if (location.pathname === '/old-otjh/monitor') return <Shell><MonitoringDashboard /></Shell>;
  if (student && coachPath) return <Navigate to="/old-otjh" replace />;
  if (monitor && (!coachPath || !aptemId)) return <Navigate to="/old-otjh/monitor" replace />;
  if (!student && !coachPath) return <Navigate to="/old-otjh/coach" replace />;
  const selectedId = coachPath && aptemId ? Number(aptemId) : undefined;
  return <Shell>{monitor && <div className={styles.monitorToolbar}><Link to="/old-otjh/monitor" className={btnSecondary}><AppIcon className="ri-arrow-left-line" />All learners</Link><RecordBadge tone="brand">Read-only monitoring</RecordBadge></div>}{month ? <MonthReport key={`${selectedId}-${month}`} month={month} aptemId={selectedId} />
    : coachPath && !aptemId ? <CoachList />
    : coachPath || location.pathname.endsWith('/months') ? <MonthList aptemId={selectedId} /> : <Portal />}</Shell>;
}
