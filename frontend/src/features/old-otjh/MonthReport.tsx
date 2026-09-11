import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { MonthReportSkeleton } from './RecordSkeletons';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { inputClass } from '@/pages/users/components/ui';
import { useRecordSummary } from './useRecordSummary';
import { ActivityLog, LearnerInformation, MonthlyHours } from './ReportSections';
import { SignatureCapture } from './SignatureCapture';
import { BulkSignDialog } from './BulkSignDialog';
import { completeMonth, getMonth, getSignoffs, getSummary, reopenMonth, saveSignature, type Signature, type SignatureCaptureMethod } from './api';
import { displayDate, monthLabel, monthStatus, nextOutstanding, previousMonthSignature } from './report';
import styles from './report.module.css';
import design from './design.module.css';
import journal from './journal.module.css';
import { RecordBadge } from './RecordDesign';
import { JournalDownloads } from './JournalDownloads';

const btnPrimary = journal.primaryButton;
const btnSecondary = journal.secondaryButton;

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
  if (summary.isPending || summary.starting) return <MonthReportSkeleton />;
  if (!summary.data?.is_legacy || !summary.data.total_months) return <EmptyState title="No previous activity months are available" description="Please contact your coach." />;
  if (query.isPending) return <MonthReportSkeleton />;
  if (!query.data) return null;
  const data = query.data;
  const busy = signing.isPending || completion.isPending;
  const canSign = !readOnly && (data.status !== 'complete' || (!student && !data.coach_signature));
  const months = summary.data.months;
  const unsigned = months.filter(item => item.is_required !== false && (student ? item.status !== 'complete' : !item.coach_signature));
  const currentIndex = months.findIndex(item => item.month === month);
  const nextMonth = months[currentIndex + 1];
  const base = aptemId === undefined ? '/old-otjh/months' : `/old-otjh/coach/${aptemId}/months`;
  const reusableSignature = previousMonthSignature(months, month, student ? 'learner' : 'coach');
  const signatureRows = [{ role: 'Learner', signature: data.student_signature, own: student },
    { role: 'Coach', signature: data.coach_signature, own: !student && !readOnly }];
  return <div className={`${design.reportPage} ${journal.page}`}>
    {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">{message}</div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-foreground-600">Updates are temporarily unavailable. Your draft is still here.
      <button className={btnSecondary} onClick={() => { summary.retryStart(); refresh(); }}>Try again</button></div>}
    <nav className={`${journal.card} ${journal.filters}`} aria-label="Monthly report navigation">
      <div className={journal.filterField}><span id="journal-learner-label" className={journal.label}>Learner</span>
        <div className={journal.learnerField} aria-labelledby="journal-learner-label"><AppIcon className="ri-user-line" /><span>{summary.data.learner?.name || '—'}</span></div></div>
      <div className={journal.filterField}><label htmlFor="journal-report-month" className={journal.label}>Report month</label>
        <div className={journal.monthControl}>
          <select id="journal-report-month" className={journal.monthSelect} value={month} disabled={busy} onChange={event => navigate(`${base}/${event.target.value}`)}>
            {months.map(item => <option key={item.month} value={item.month}>{monthLabel(item.month)} · {monthStatus(item)}</option>)}
          </select>
        </div>
      </div>
    </nav>
    {bulkOpen && <BulkSignDialog summary={summary.data} aptemId={aptemId} onClose={() => setBulkOpen(false)} onSaved={result => {
      client.setQueryData(['old-otjh', auth.account?.id, 'summary', aptemId ?? 'me'], result.summary);
      setBulkOpen(false); draftDigest.current = null; setCaptureVersion(value => value + 1);
      setMessage(result.summary.can_access_lms ? 'All months are complete. Your signature is saved and LMS access is open.' : 'Your signature is saved on all months. The learner can now complete their record.');
      refresh();
    }} />}
    <LearnerInformation summary={summary.data} data={data} actions={
      <JournalDownloads summary={summary.data} month={month} aptemId={aptemId} disabled={busy} />
    } />
    <MonthlyHours data={data} />
    <ActivityLog data={data} aptemId={aptemId} />
    <section className={`${journal.card} ${journal.signoff}`} aria-label="Monthly sign-off"><div className={journal.sectionHeading}><div><h2 className="font-heading">Report sign-off</h2>
      <p>Your learner and coach signatures for this month’s record.</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2">{!readOnly && <button className={btnPrimary} disabled={busy || !unsigned.length} onClick={() => setBulkOpen(true)}><AppIcon className="ri-edit-line" />Sign all months</button>}{student && data.student_signature && (nextMonth || summary.data.can_access_lms) && <button className={btnPrimary} disabled={busy} onClick={() => nextMonth ? navigate(`${base}/${nextMonth.month}`) : navigate('/workspace/learner')}>{nextMonth ? 'Next month' : 'Open LMS'}<AppIcon className="ri-arrow-right-line" /></button>}</div>
      </div>
      <div className={journal.signoffBody}><div className={styles.reportTableWrap}>
      <table className={styles.signTable} aria-label="Report sign-off"><thead><tr>{['Role', 'Signature', 'Print name', 'Date', 'Status'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{signatureRows.map(row => <tr key={row.role}>
          <td data-label="Role"><span className="text-[11px] font-semibold uppercase tracking-wider">{row.role}</span>{row.own && <span className={journal.ownLabel}>(you)</span>}</td>
          <td className={styles.signatureCell} data-label="Signature">
            {row.signature && <img src={row.signature.url} alt={`${row.role} signature`} className={`${design.signatureImage} ${journal.signatureImage}`} />}
            {row.own && canSign ? <SignatureCapture key={captureVersion} name={auth.account?.displayName || auth.user?.fullName || ''} busy={busy}
              dialogRole={student ? 'learner' : 'coach'} hasSavedSignature={Boolean(row.signature)} saveError={signing.error?.message}
              importSignature={reusableSignature}
              confirmationText={student ? "I confirm this is my signature. Save it and complete this month." : "I confirm this is my coach signature for this month."}
              onDraftStart={() => { draftDigest.current ??= data.snapshot_digest; }} onDraftReset={() => { draftDigest.current = null; }}
              onSave={(blob, capture) => signing.mutate({ blob, capture })} />
              : !row.signature && <div className={design.awaitingSignature}><span className="font-medium">{row.role === 'Coach' ? 'Optional coach signature' : 'Awaiting signature'}</span>
                {!row.own && <span>{row.role === 'Coach' ? 'Your coach can draw or upload their signature from their coach account.' : 'The learner can draw or upload their signature from their own account.'}</span>}</div>}
          </td>
          <td data-label="Print name">{row.signature?.signer_name || '—'}</td>
          <td data-label="Date"><span className="whitespace-nowrap text-[12px]">{displayDate(row.signature?.signed_at)}</span></td>
          <td data-label="Status"><RecordBadge tone={row.signature ? 'positive' : 'pending'}><AppIcon className={row.signature ? 'ri-checkbox-circle-line' : 'ri-time-line'} />{row.signature ? 'Signed' : 'Awaiting signature'}</RecordBadge></td>
        </tr>)}</tbody></table></div></div>
    </section>
    {confirming && <Modal size="max-w-lg" className={`${design.scope} ${design.dialog}`} title={`Complete ${monthLabel(month)}?`} onClose={() => { if (!busy) setConfirming(false); }} footer={<>
      <button className={btnSecondary} disabled={busy} onClick={() => setConfirming(false)}>Keep reviewing</button>
      <button className={btnPrimary} disabled={busy || !data.can_complete} onClick={() => completion.mutate()}>{busy ? 'Completing…' : 'Confirm completion'}</button>
    </>}><p className="text-sm text-foreground-600">Confirm completion of this signed month. Once complete, its signatures will be read-only.</p></Modal>}
    {auth.account?.access === 'super-admin' && aptemId !== undefined && data.source_finalization?.event_type === 'finalized' && <Panel className="space-y-3">
      <label className="block text-sm">Reason for reopening<input value={reason} onChange={event => setReason(event.target.value)} className={inputClass} /></label>
      <button className={btnSecondary} disabled={reason.trim().length < 3 || reopening.isPending} onClick={() => reopening.mutate()}>Reopen month</button>
    </Panel>}
  </div>;
}


