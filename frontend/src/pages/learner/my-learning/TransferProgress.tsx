import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { getTransferPreview, submitTransferRequest, type TransferPreview } from '@/api/progressTransfer';
import { Modal } from '@/pages/users/components/Modal';
import styles from './SubjectWorkspace.module.css';

export function TransferProgress({ kind, learnerId, onRequested }: { kind: LearnerKind; learnerId: string; onRequested: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.primaryButton} onClick={() => setOpen(true)}><ArrowRightLeft size={16} aria-hidden="true" />Transfer Progress</button>
    {open && <TransferDialog key={`${kind}:${learnerId}`} kind={kind} learnerId={learnerId} onRequested={onRequested} onClose={() => setOpen(false)} />}
  </>;
}

function TransferDialog({ kind, learnerId, onRequested, onClose }: { kind: LearnerKind; learnerId: string; onRequested: () => void; onClose: () => void }) {
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void getTransferPreview(kind, learnerId, controller.signal).then(value => {
      if (!controller.signal.aborted) setPreview(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load transfer instructions.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, learnerId, retry]);
  const pending = preview?.requests.find(item => item.status === 'pending');
  const canConfirm = !!preview?.eligible.length && !pending && !loading && !saving;
  async function confirm() {
    if (!canConfirm || !preview) return;
    setSaving(true); setError('');
    try {
      const result = await submitTransferRequest(kind, learnerId, preview.csrfToken);
      setPreview({ ...preview, eligible: [], requests: [...preview.requests, result] });
      onRequested();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not submit your request. Please try again.'); }
    finally { setSaving(false); }
  }
  return <Modal title="Transfer Progress" onClose={onClose} dismissible={!saving} size="max-w-2xl" footer={<>
    <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2">Close</button>
    {preview?.eligible.length && !pending ? <button type="button" disabled={!canConfirm} onClick={() => void confirm()} className="rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Submitting…' : 'Confirm'}</button> : null}
  </>}>
    <div className="space-y-4 p-5 text-sm text-foreground-700" aria-busy={loading || saving}>
      <p>Transfer your progress from all eligible old LMS modules to their matching modules in the new LMS.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Your progress percentage and recorded hours are saved when you confirm.</li>
        <li>From that moment, additional progress on these old LMS modules will no longer count.</li>
        <li>An administrator must approve your request before the new modules appear.</li>
        <li>After approval, matching activities already completed in the old LMS stay completed. They are included in your transferred percentage and are not counted twice. New progress is added up to 100%.</li>
        <li>Your previous learning records and evidence are retained.</li>
      </ul>
      {loading && <p role="status">Loading eligible modules…</p>}
      {error && <div role="alert"><p>{error}</p>{!preview && <button type="button" className="mt-2 underline" onClick={() => setRetry(value => value+1)}>Try again</button>}</div>}
      {pending && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3">Request submitted. Awaiting administrator approval. Progress on the included old LMS modules is now frozen.</p>}
      {!loading && preview && !pending && !preview.eligible.length && <p role="status">{preview.requests.length ? 'Your eligible modules have already been transferred.' : 'No old modules currently have a verified new LMS module to transfer to.'}</p>}
      {!!preview?.eligible.length && !pending && <section aria-label="Modules to transfer"><h3 className="mb-2 font-semibold">All {preview.eligible.length} eligible modules</h3><ul className="space-y-2">{preview.eligible.map(item => <li key={item.courseRef} className="rounded-lg bg-background-100 p-3"><strong>{item.oldTitle}</strong>{item.demoProgress && <p className="text-xs text-amber-700">Demo progress: transfer rehearsal only.</p>}<p className="mt-1 text-xs">New LMS: {item.newTitle}</p></li>)}</ul></section>}
    </div>
  </Modal>;
}
