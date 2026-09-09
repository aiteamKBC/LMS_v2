import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/feature/Skeletons';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { inputClass } from '@/pages/users/components/ui';
import { useRecordSummary } from './useRecordSummary';
import { ActivityLog, LearnerInformation, MonthlyHours } from './ReportSections';
import { SignatureCapture } from './SignatureCapture';
import { BulkSignDialog } from './BulkSignDialog';
import { completeMonth, getContentReview, getMonth, getSignoffs, getSummary, reopenMonth, saveSignature, type Signature, type SignatureCaptureMethod } from './api';
import { displayDate, monthLabel, monthStatus, nextOutstanding } from './report';
import styles from './report.module.css';
import design from './design.module.css';
import { RecordBadge } from './RecordDesign';

const btnPrimary = design.primaryButton;
const btnSecondary = design.secondaryButton;

export function MonthReport({ month, aptemId }: { month: string; aptemId?: number }) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const student = auth.account?.role === 'learner';
  const readOnly = auth.account?.access === 'record-monitor';
  const [bulkOpen, setBulkOpen] = useState(false);
  const summary = useRecordSummary(aptemId, true);
  const key = ['old-otjh', auth.account?.id, 'month', aptemId ?? 'me', month];
  const query = useQuery({ queryKey: key, queryFn: () => getMonth(month, aptemId), refetchInterval: 7000,
    enabled: Boolean(summary.data?.is_legacy && (!summary.data.needs_start || readOnly)) });
  const contentReview = useQuery({ queryKey: ['old-otjh', auth.account?.id, 'content-check', aptemId ?? 'me', month, query.data?.snapshot_digest],
    queryFn: () => getContentReview(month, aptemId), enabled: Boolean(query.data && query.data.status !== 'complete' && !bulkOpen), refetchInterval: 15000, retry: 1 });
  const live = useQuery({ queryKey: ['old-otjh', auth.account?.id, 'signoffs', aptemId ?? 'me', month],
    queryFn: () => getSignoffs(summary.data!.learner!.aptem_id, month),
    enabled: Boolean(query.data && summary.data?.learner), refetchInterval: 3000, staleTime: 0 });
  const lastLiveUpdate = useRef(0);
  useEffect(() => {
    if (!live.data || !query.data || lastLiveUpdate.current === live.dataUpdatedAt) return;
    lastLiveUpdate.current = live.dataUpdatedAt;
    const signatureKey = (value: Signature | null) => value ? [value.url, value.signed_at, value.signer_name].join('|') : '';
    if (signatureKey(live.data.signoffs.learner) !== signatureKey(query.data.student_signature)
      || signatureKey(live.data.signoffs.coach) !== signatureKey(query.data.coach_signature)) {
      void client.invalidateQueries({ queryKey: ['old-otjh', auth.account?.id, 'month', aptemId ?? 'me', month] });
      void client.invalidateQueries({ queryKey: ['old-otjh', auth.account?.id, 'summary', aptemId ?? 'me'] });
    }
  }, [live.data, live.dataUpdatedAt, query.data, client, auth.account?.id, aptemId, month]);
  const [message, setMessage] = useState((location.state as { completedMonth?: string } | null)?.completedMonth
    ? `${monthLabel((location.state as { completedMonth: string }).completedMonth)} has been completed. Review your next outstanding month below.` : '');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [captureVersion, setCaptureVersion] = useState(0);
  // Polling can update the displayed report, but signing still attests the
  // version present when this draft started. A conflict requires a fresh review.
  const draftDigest = useRef<string | null>(null);
  const refresh = () => { void client.invalidateQueries({ queryKey: ['old-otjh'] }); };
  const signing = useMutation({ mutationFn: ({ blob, capture }: { blob: Blob; capture: SignatureCaptureMethod }) =>
    saveSignature(summary.data!.learner!.aptem_id, month, draftDigest.current || query.data!.snapshot_digest, blob, capture),
    onSuccess: data => { setMessage(data.status === 'complete' ? 'Your signature is saved and this month is now complete.' : 'Your signature is saved. The learner completes the record with their signature.'); draftDigest.current = null; setCaptureVersion(value => value + 1); client.setQueryData(key, data); refresh(); }, onError: refresh });
  const completion = useMutation({ mutationFn: () => completeMonth(month), onSuccess: async data => {
    setConfirming(false); setMessage('This month has been reviewed, signed and completed.'); client.setQueryData(key, data); refresh();
    try {
      const fresh = await getSummary();
      client.setQueryData(['old-otjh', auth.account?.id, 'summary', 'me'], fresh);
      const next = nextOutstanding(fresh, month);
      if (next) navigate(`/old-otjh/months/${next}`, { state: { completedMonth: month } });
    } catch { setMessage('This month is complete. Refresh the month list to check your remaining reviews.'); }
  }, onError: () => { setConfirming(false); refresh(); } });
  const reopening = useMutation({ mutationFn: () => reopenMonth(month, aptemId!, reason),
    onSuccess: () => { setReason(''); setMessage('The month has been reopened.'); refresh(); } });
  const error = query.error || summary.error;
  if (error && (!query.data || !summary.data)) return <Panel><EmptyState variant="error" title="Unable to load the previous record" description={error.message}
    action={<button className={btnSecondary} onClick={() => { summary.retryStart(); refresh(); }}>Try again</button>} /></Panel>;
  if (summary.isPending || summary.starting) return <PageSkeleton />;
  if (!summary.data?.is_legacy || !summary.data.total_months) return <EmptyState title="No previous activity months are available" description="Please contact your coach." />;
  if (query.isPending) return <PageSkeleton />;
  if (!query.data) return null;
  const data = query.data;
  const busy = signing.isPending || completion.isPending;
  const contentReady = contentReview.data?.ready === true && contentReview.data.snapshot_digest === data.snapshot_digest && !contentReview.isError;
  const canSign = !readOnly && data.status !== 'complete' && data.row_count > 0 && !data.pending_revisions && contentReady;
  const mutationError = signing.error || completion.error || reopening.error;
  const base = aptemId === undefined ? '/old-otjh/months' : `/old-otjh/coach/${aptemId}/months`;
  const months = summary.data.months;
  const index = months.findIndex(item => item.month === month);
  const previous = months[index - 1]; const next = months[index + 1];
  const reusableLearnerSignature = [...months]
    .filter(item => item.month !== month && item.student_signature)
    .sort((left, right) => right.month.localeCompare(left.month))[0];
  const signatureRows = [{ role: 'Learner', signature: data.student_signature, own: student },
    { role: 'Coach', signature: data.coach_signature, own: !student && !readOnly }];
  let completionHint = student
    ? reusableLearnerSignature
      ? 'Import your saved learner signature, confirm it for this month, and continue month by month.'
      : 'Draw or upload your learner signature for this first month. You can import it in the remaining months.'
    : 'The learner’s signature completes this month. Coach signatures can be added separately.';
  if (data.student_signature) completionHint = 'Your learner signature is saved for this month.';
  if (readOnly) completionHint = 'Viewing only. The learner completes this record from their own account.';
  return <div className={design.reportPage}>
    {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">{message}</div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-foreground-600">Updates are temporarily unavailable. Your draft is still here.
      <button className={btnSecondary} onClick={() => { summary.retryStart(); refresh(); }}>Try again</button></div>}
    <nav className={design.reportNav} aria-label="Monthly report navigation">
      <button className={btnSecondary} disabled={!previous || busy} onClick={() => navigate(`${base}/${previous.month}`)} aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line" />Previous</button>
      <select aria-label="Report month" className={inputClass} value={month} disabled={busy} onChange={event => navigate(`${base}/${event.target.value}`)}>
        {months.map(item => <option key={item.month} value={item.month}>{monthLabel(item.month)} · {monthStatus(item)}</option>)}
      </select>
      <button className={btnSecondary} disabled={!next || busy} onClick={() => navigate(`${base}/${next.month}`)} aria-label="Next month">Next<AppIcon className="ri-arrow-right-s-line" /></button>
      <Link to={aptemId === undefined ? base : `/old-otjh/coach/${aptemId}`} className={btnSecondary}><AppIcon className="ri-layout-grid-line" />All months</Link>
    </nav>
    {!readOnly && !student && <div className={design.bulkActions}>
      <p>{summary.data.can_access_lms ? 'Your previous learning record is complete.' : 'One signature for your entire previous learning record.'}</p>
      <button className={btnPrimary} disabled={busy || summary.data.can_access_lms} onClick={() => setBulkOpen(true)}><AppIcon className="ri-edit-line" />Sign all months</button>
    </div>}
    {bulkOpen && <BulkSignDialog summary={summary.data} aptemId={aptemId} onClose={() => setBulkOpen(false)} onSaved={result => {
      client.setQueryData(['old-otjh', auth.account?.id, 'summary', aptemId ?? 'me'], result.summary);
      setBulkOpen(false); draftDigest.current = null; setCaptureVersion(value => value + 1);
      setMessage(result.summary.can_access_lms ? 'All months are complete. Your signature is saved and LMS access is open.' : 'Your signature is saved on all months. The learner can now complete their record.');
      refresh();
    }} />}
    <div className={design.reportOverview}><LearnerInformation summary={summary.data} data={data} /><MonthlyHours data={data} /></div>
    <p className={design.syncNote} role="status"><AppIcon className={live.isError ? 'ri-wifi-off-line' : 'ri-refresh-line'} />
      {live.isError ? 'Signature updates are temporarily delayed. Retrying automatically.' : 'Signatures update automatically while you review. Each person signs from their own account.'}</p>
    <ActivityLog data={data} aptemId={aptemId} />
    {data.status !== 'complete' && !contentReady && !bulkOpen && <section aria-label="Learning material check" className={`${design.card} p-5`}>
      <h2 className="text-base font-semibold">{contentReview.isPending ? 'Checking your learning materials…' : 'Learning materials need attention'}</h2>
      <p className="mt-2 text-sm text-foreground-600">{contentReview.isPending
        ? 'You can read the report while we check its content. Signing becomes available when the required materials can be reviewed.'
        : student
          ? 'Some materials are unavailable for individual review. Please ask your coach to restore them before you sign this month.'
          : 'Some materials are unavailable for individual review. You can still use Sign all months for the coach sign-off.'}</p>
      {contentReview.error && <p role="alert" className="mt-3 text-sm">{contentReview.error.message}</p>}
      {!!contentReview.data?.issues.length && <ul className="mt-4 space-y-2 text-sm">{contentReview.data.issues.map(issue =>
        <li key={issue.id}><strong>{issue.title || 'Untitled activity'}</strong><span className="text-foreground-600"> — {issue.reason}</span></li>)}</ul>}
      {!contentReview.isPending && <button className={`${btnSecondary} mt-4`} disabled={contentReview.isFetching} onClick={() => void contentReview.refetch()}>{contentReview.isFetching ? 'Checking…' : 'Check again'}</button>}
    </section>}
    <section className={`${design.card} overflow-hidden`} aria-label="Monthly sign-off"><div className={design.sectionHeading}><div><h2 className="font-heading">Report sign-off</h2>
      <p>Your learner and coach signatures for this month’s record.</p></div><span className={design.iconTile}><AppIcon className="ri-edit-line" /></span></div>
      <div className={design.sectionBody}><div className={styles.reportTableWrap}>
      <table className={styles.signTable} aria-label="Report sign-off"><thead><tr>{['Role', 'Signature', 'Print name', 'Date', 'Status'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{signatureRows.map(row => <tr key={row.role}>
          <td data-label="Role"><span className="text-[11px] font-semibold uppercase tracking-wider">{row.role}</span>{row.own && <span className="mt-1 block text-[11px] text-primary-600">(you)</span>}</td>
          <td className={styles.signatureCell} data-label="Signature">
            {row.signature && <img src={row.signature.url} alt={`${row.role} signature`} className={design.signatureImage} />}
            {row.own && data.status !== 'complete' ? <SignatureCapture key={captureVersion} name={auth.account?.displayName || auth.user?.fullName || ''} busy={busy || !canSign}
              dialogRole={student ? 'learner' : 'coach'} hasSavedSignature={Boolean(row.signature)} saveError={signing.error?.message}
              importSignature={student && reusableLearnerSignature?.student_signature ? {
                url: reusableLearnerSignature.student_signature.url,
                monthLabel: monthLabel(reusableLearnerSignature.month),
              } : undefined}
              confirmationText={student ? "I confirm this is my signature. Save it and complete this month." : "I confirm this is my coach signature for this month."}
              onDraftStart={() => { draftDigest.current ??= data.snapshot_digest; }} onDraftReset={() => { draftDigest.current = null; }}
              onSave={(blob, capture) => signing.mutate({ blob, capture })} />
              : !row.signature && <div className={design.awaitingSignature}><span className="font-medium">{row.role === 'Coach' ? 'Optional coach signature' : 'Awaiting signature'}</span>
                {!row.own && <span>{row.role === 'Coach' ? 'Your coach can draw or upload their signature from their coach account.' : 'The learner can draw or upload their signature from their own account.'}</span>}</div>}
          </td>
          <td data-label="Print name">{row.signature?.signer_name || '—'}</td>
          <td data-label="Date"><span className="whitespace-nowrap text-[12px]">{displayDate(row.signature?.signed_at)}</span></td>
          <td data-label="Status"><RecordBadge tone={row.signature ? 'positive' : row.role === 'Coach' ? 'neutral' : 'pending'}><AppIcon className={row.signature ? 'ri-checkbox-circle-line' : 'ri-time-line'} />{row.signature ? 'Signed' : row.role === 'Coach' ? 'Not provided' : 'Awaiting signature'}</RecordBadge></td>
        </tr>)}</tbody></table></div></div>
      <div className={`${design.signFooter} space-y-3`}>
        {data.status === 'complete' ? <div className="flex items-start gap-3 text-emerald-700"><AppIcon className="ri-checkbox-circle-line text-xl" />
          <div><p className="text-[13px] font-semibold">This month has been reviewed, signed and completed.</p><p className="mt-1 text-[12px]">Its signatures are read-only. You can still view activities and documents.</p></div></div>
          : <><p role="status" className="text-[13px] text-foreground-600">{completionHint}</p>
            {student && data.can_complete && <button className={btnPrimary} disabled={!contentReady || busy} onClick={() => setConfirming(true)}>Complete month<AppIcon className="ri-check-line" /></button>}</>}
        {student && summary.data.can_access_lms && <Link className={btnPrimary} to="/workspace/learner">Open LMS<AppIcon className="ri-arrow-right-line" /></Link>}
        {mutationError && <p role="alert" className="text-[13px] text-red-600">{mutationError.message}</p>}
      </div>
    </section>
    {confirming && <Modal size="max-w-lg" className={`${design.scope} ${design.dialog}`} title={`Complete ${monthLabel(month)}?`} onClose={() => { if (!busy) setConfirming(false); }} footer={<>
      <button className={btnSecondary} disabled={busy} onClick={() => setConfirming(false)}>Keep reviewing</button>
      <button className={btnPrimary} disabled={busy || !data.can_complete || !contentReady} onClick={() => completion.mutate()}>{busy ? 'Completing…' : 'Confirm completion'}</button>
    </>}><p className="text-sm text-foreground-600">Confirm completion of this signed month. Once complete, its signatures will be read-only.</p></Modal>}
    {auth.account?.access === 'super-admin' && aptemId !== undefined && data.source_finalization?.event_type === 'finalized' && <Panel className="space-y-3">
      <label className="block text-sm">Reason for reopening<input value={reason} onChange={event => setReason(event.target.value)} className={inputClass} /></label>
      <button className={btnSecondary} disabled={reason.trim().length < 3 || reopening.isPending} onClick={() => reopening.mutate()}>Reopen month</button>
    </Panel>}
  </div>;
}
