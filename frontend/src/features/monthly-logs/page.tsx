import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { LearnerInformation, MonthlyHours, ActivityLog } from '@/features/old-otjh/ReportSections';
import { JournalDownloads } from '@/features/old-otjh/JournalDownloads';
import { SignatureCapture } from '@/features/old-otjh/SignatureCapture';
import { RecordBadge } from '@/features/old-otjh/RecordDesign';
import { MonthListSkeleton, MonthReportSkeleton } from '@/features/old-otjh/RecordSkeletons';
import { displayDate, monthLabel, monthStatus, previousMonthSignature } from '@/features/old-otjh/report';
import { coachViewAs } from '@/lib/coachViewAs';
import { completeMonth, type SignatureCaptureMethod } from '@/features/old-otjh/api';
import design from '@/features/old-otjh/design.module.css';
import journal from '@/features/old-otjh/journal.module.css';
import reportStyles from '@/features/old-otjh/report.module.css';
import { getLogContent, getLogLearners, getLogMonth, getLogSummary, signLogMonth, type LogSummary, type LogPerspective } from './api';
import styles from './monthlyLogs.module.css';
import { MonthList, MonthIndexSkeleton } from './MonthList';

export default function MonthlyLogsPage() {
  const { auth } = useAuth();
  const { learnerId, kind, id: routeId, month } = useParams<{ learnerId?: string; kind?: string; id?: string; month?: string }>();
  const { pathname } = useLocation();
  const student = auth.account?.role === 'learner';
  const perspective: LogPerspective = student || pathname.startsWith('/learner/') ? 'learner' : 'coach';
  const selected = useResolvedLearner(student ? undefined : kind, student ? undefined : routeId);
  const id = student ? String(auth.account?.subjectId ?? '') : perspective === 'learner' ? selected.id : learnerId;
  const base = perspective === 'learner' ? student ? '/learner/monthly-logs' : `/learner/monthly-logs/${selected.kind}/${id}` : `/coach/monthly-logs/${id}`;
  const overview = student ? '/workspace/learner' : `/workspace/learner/${selected.kind}/${id}`;
  const nav = roleNavMap[perspective];
  return <WorkspaceShell role={perspective} roleLabel={nav.label} navItems={nav.items}
    workspaceLabel={nav.workspaceLabel} pageTitle="Monthly Logs" pageSubtitle="Your monthly learning record, activities and signatures"
    showBackButton backFallbackHref={month ? base : perspective === 'learner' ? overview : '/coach/monthly-logs'}>
    <PageContainer className={`${design.scope} ${design.page} ${styles.theme} ${month ? journal.canvas : ''}`}>
      {id ? <LearnerLogs key={`${perspective}-${id}`} id={id} month={month} base={base} perspective={perspective} /> : perspective === 'learner'
        ? <EmptyState title="Your learner account is unavailable" /> : <CoachLearners />}
    </PageContainer>
  </WorkspaceShell>;
}

function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return <EmptyState variant="error" title="Unable to load monthly logs" description={error.message}
    action={<button className={journal.secondaryButton} onClick={retry}>Try again</button>} />;
}

function CoachLearners() {
  const { auth } = useAuth();
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['monthly-logs', auth.account?.id, coachViewAs()?.email, 'learners'], queryFn: getLogLearners });
  if (query.isPending) return <MonthListSkeleton />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const learners = query.data.learners.filter(learner => `${learner.name} ${learner.programme}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={design.monthList}>
    <header className={design.monthListHeader}><h1 className="font-heading font-semibold">Monthly Logs</h1><p>Open a learner’s monthly record to review activities and add your signature.</p></header>
    <label className="block space-y-2 text-sm">Search learners<input type="search" className="block w-full rounded-xl border p-3" value={search} onChange={e => setSearch(e.target.value)} /></label>
    {learners.length ? <div className="grid gap-4 md:grid-cols-2">{learners.map(learner => <Link className={`${journal.card} block p-5`} to={`/coach/monthly-logs/${learner.id}`} key={learner.id}>
      <h2 className="font-semibold">{learner.name}</h2><p className="mt-2 text-sm">{learner.programme}</p><span className="mt-4 inline-block text-sm font-semibold">Open monthly logs →</span>
    </Link>)}</div> : <EmptyState title="No learners found" />}
  </div>;
}

function LearnerLogs({ id, month, base, perspective }: { id: string; month?: string; base: string; perspective: LogPerspective }) {
  const { auth } = useAuth();
  const query = useQuery({ queryKey: ['monthly-logs', auth.account?.id, perspective, perspective === 'coach' ? coachViewAs()?.email : null, id, 'summary'],
    queryFn: ({ signal }) => getLogSummary(id, signal, perspective), refetchInterval: 7000 });
  if (query.isPending) return <MonthIndexSkeleton />;
  if (query.error && !query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return null;
  const summary = { ...query.data, months: [...query.data.months].sort((a, b) => a.month.localeCompare(b.month)) };
  return <>
    {query.error && <p role="alert">Updates are temporarily unavailable. <button onClick={() => void query.refetch()}>Try again</button></p>}
    {month ? <MonthlyLog key={`${id}-${month}`} id={id} month={month} summary={summary} base={base} perspective={perspective} /> : <MonthList summary={summary} base={base} perspective={perspective} />}
  </>;
}

function MonthlyLog({ id, month, summary, base, perspective }: { id: string; month: string; summary: LogSummary; base: string; perspective: LogPerspective }) {
  const { auth } = useAuth();
  const { search } = useLocation();
  const sourceRef = new URLSearchParams(search).get('source') || undefined;
  const navigate = useNavigate();
  const client = useQueryClient();
  const student = auth.account?.role === 'learner';
  const readOnly = summary.read_only || (perspective === 'learner' && !student);
  const key = ['monthly-logs', auth.account?.id, perspective, perspective === 'coach' ? coachViewAs()?.email : null, id, month];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => getLogMonth(id, month, signal, perspective), refetchInterval: 7000 });
  const draftDigest = useRef<string | null>(null);
  const [captureVersion, setCaptureVersion] = useState(0);
  const [message, setMessage] = useState('');
  const signing = useMutation({ mutationFn: ({ blob, capture }: { blob: Blob; capture: SignatureCaptureMethod }) =>
    signLogMonth(id, month, draftDigest.current || query.data!.snapshot_digest, blob, capture, summary.csrf_token, perspective),
    onSuccess: data => { client.setQueryData(key, data); draftDigest.current = null; setCaptureVersion(v => v + 1);
      setMessage('Your signature has been saved for this month.'); void client.invalidateQueries({ queryKey: ['monthly-logs'] });
      if (data.source === 'legacy') void client.invalidateQueries({ queryKey: ['old-otjh'] }); },
    onError: () => { void client.invalidateQueries({ queryKey: ['monthly-logs'] }); } });
  const completion = useMutation({ mutationFn: () => completeMonth(month), onSuccess: data => {
    client.setQueryData(key, { ...data, source: 'legacy' });
    setMessage('This month has been reviewed, signed and completed.');
    void client.invalidateQueries({ queryKey: ['monthly-logs'] });
    void client.invalidateQueries({ queryKey: ['old-otjh'] });
  } });
  if (query.isPending) return <MonthReportSkeleton />;
  if (query.error && !query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return null;
  const data = query.data;
  const index = summary.months.findIndex(m => m.month === month);
  const previous = summary.months[index - 1], next = summary.months[index + 1];
  const signatureRows = [{ role: 'Learner', signature: data.student_signature, own: student }, { role: 'Coach', signature: data.coach_signature, own: !student && perspective === 'coach' }];
  return <div className={`${design.reportPage} ${journal.page}`}>
    {message && <p role="status" className={styles.savedMessage}>{message}</p>}
    {query.error && <p role="alert">Updates are temporarily unavailable. <button onClick={() => void query.refetch()}>Try again</button></p>}
    <nav className={`${journal.card} ${journal.filters}`} aria-label="Monthly report navigation">
      <div className={journal.filterField}><span className={journal.label}>Learner</span><div className={journal.learnerField}><AppIcon className="ri-user-line" />{summary.learner?.name}</div></div>
      <div className={journal.filterField}><label htmlFor="monthly-log-month" className={journal.label}>Report month</label><div className={journal.monthControl}>
        <select id="monthly-log-month" className={journal.monthSelect} value={month} disabled={signing.isPending} onChange={e => navigate(`${base}/${e.target.value}`)}>
          {summary.months.map(item => <option key={item.month} value={item.month}>{monthLabel(item.month)} · {monthStatus(item)}</option>)}</select>
        <button className={journal.secondaryButton} disabled={!previous || signing.isPending} onClick={() => navigate(`${base}/${previous.month}`)} aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line" /></button>
        <button className={journal.secondaryButton} disabled={!next || signing.isPending} onClick={() => navigate(`${base}/${next.month}`)} aria-label="Next month"><AppIcon className="ri-arrow-right-s-line" /></button>
        <Link className={journal.secondaryButton} to={base}><AppIcon className="ri-layout-grid-line" />All months</Link>
      </div></div>
    </nav>
    <LearnerInformation summary={summary} data={data} actions={<JournalDownloads summary={summary} month={month} disabled={signing.isPending} loadMonth={(selected, signal) => getLogMonth(id, selected, signal, perspective)} />} />
    <MonthlyHours data={data} />
    <ActivityLog key={sourceRef ?? 'all'} data={data} initialSourceRef={sourceRef}
      contentScope={`monthly-logs:${perspective}:${id}`} loadContent={rowId => getLogContent(id, month, rowId, perspective)} />
    <section className={`${journal.card} ${journal.signoff}`} aria-label="Monthly sign-off">
      <div className={journal.sectionHeading}><div><h2 className="font-heading">Report sign-off</h2><p>Your learner and coach signatures for this month’s record.</p></div></div>
      <div className={journal.signoffBody}><div className={reportStyles.reportTableWrap}><table className={reportStyles.signTable} aria-label="Report sign-off">
        <thead><tr>{['Role', 'Signature', 'Print name', 'Date', 'Status'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{signatureRows.map(item => <tr key={item.role}>
          <td data-label="Role">{item.role}{item.own && <span className={journal.ownLabel}>(you)</span>}</td>
          <td className={reportStyles.signatureCell} data-label="Signature">{item.signature ? <img src={item.signature.url} alt={`${item.role} signature`} className={`${design.signatureImage} ${journal.signatureImage}`} />
            : item.own && !readOnly ? <SignatureCapture key={captureVersion} name={auth.account?.displayName || ''} busy={signing.isPending} dialogRole={student ? 'learner' : 'coach'}
              saveError={signing.error?.message} importSignature={previousMonthSignature(summary.months, month, student ? 'learner' : 'coach')}
              confirmationText="I have reviewed this month's activities and confirm this is my signature."
              onDraftStart={() => { draftDigest.current ??= data.snapshot_digest; }} onDraftReset={() => { draftDigest.current = null; signing.reset(); }}
              onSave={(blob, capture) => signing.mutate({ blob, capture })} /> : <span>Awaiting signature</span>}</td>
          <td data-label="Print name">{item.signature?.signer_name || '—'}</td><td data-label="Date">{displayDate(item.signature?.signed_at)}</td>
          <td data-label="Status"><RecordBadge tone={item.signature ? 'positive' : 'pending'}>{item.signature ? 'Signed' : 'Awaiting signature'}</RecordBadge></td>
        </tr>)}</tbody>
      </table></div></div>
      <div className={`${journal.signoffFooter} space-y-3`}>
        {student && !readOnly && data.source === 'legacy' && data.can_complete && <button className={journal.primaryButton} disabled={completion.isPending} onClick={() => completion.mutate()}>Complete month</button>}
        <p className={journal.signingNote}>{readOnly ? 'You are viewing this learner’s record. Each person signs from their own account.' : 'Each person signs from their own account. Saved signatures are retained.'}</p>
        {signing.error && <p role="alert" className="text-red-700">{signing.error.message}</p>}
        {completion.error && <p role="alert" className="text-red-700">{completion.error.message}</p>}
      </div>
    </section>
  </div>;
}
