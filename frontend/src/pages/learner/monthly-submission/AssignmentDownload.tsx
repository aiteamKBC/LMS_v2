import { useEffect, useRef, useState } from 'react';
import { Download, Eye, X } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { buildAssignmentReport } from './downloadAssignment';
import styles from './monthlySubmission.module.css';
import { AssignmentPdfPreview } from './AssignmentPdfPreview';

export function AssignmentDownload({ kind, learnerId, activityId, month = '' }: { kind: LearnerKind; learnerId: string; activityId: string; month?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [report, setReport] = useState<{ url: string; filename: string } | null>(null);
  const active = useRef(true);
  const urlRef = useRef('');
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);
  async function prepare(action: 'preview' | 'download') {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      let current = report;
      if (!current) {
        const result = await buildAssignmentReport(kind, learnerId, activityId, month);
        if (!active.current) return;
        current = { url: URL.createObjectURL(result.blob), filename: result.filename };
        urlRef.current = current.url; setReport(current);
      }
      if (action === 'preview') setPreview(true);
      else {
        const link = document.createElement('a');
        link.href = current.url; link.download = current.filename;
        document.body.appendChild(link); link.click(); link.remove();
      }
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : 'Could not prepare your assignment report. Please try again.'); }
    finally { running.current = false; if (active.current) setBusy(false); }
  }
  return <section aria-label="Assignment PDF report">
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => void prepare('download')}>
        <Download size={17} aria-hidden="true" />Download report (PDF)
      </button>
      <button type="button" className={styles.secondary} disabled={busy} aria-expanded={preview} onClick={() => preview ? setPreview(false) : void prepare('preview')}>
        {preview ? <X size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}{preview ? 'Hide preview' : 'Preview report'}
      </button>
    </div>
    <p className={styles.feedbackReviewer}>KBC report with your submitted work and full coach feedback.</p>
    {busy && <p role="status">Preparing your PDF report...</p>}
    {error && <p role="alert">{error}</p>}
    {preview && report && <div className={styles.attachmentPreview}>
      <AssignmentPdfPreview url={report.url} filename={report.filename} />
    </div>}
  </section>;
}
