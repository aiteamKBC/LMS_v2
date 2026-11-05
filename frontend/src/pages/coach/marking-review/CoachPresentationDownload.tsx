import { useEffect, useRef, useState } from 'react';
import { downloadSavedPresentation } from '@/features/coach/marking/api/presentationDownload';
import type { MarkingScope } from '@/features/coach/marking/types/marking.types';
import styles from './coachPresentationDownload.module.css';

export function CoachPresentationDownload({ scope, submissionId, submittedAt, version }: {
  scope: MarkingScope; submissionId: string; submittedAt?: string | null; version?: number;
}) {
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => () => { request.current?.abort(); }, []);
  const download = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError(''); setSaved(false);
    try {
      const { blob, filename } = await downloadSavedPresentation({ scope, submissionId, submittedAt, version, signal: controller.signal });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = filename;
        document.body.append(anchor); anchor.click(); anchor.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      setSaved(true);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not download the saved presentation. Please retry.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <section className={styles.panel} aria-label="Saved presentation" aria-busy={busy}>
    <div><h4>Presentation</h4><p>Download the PowerPoint saved with this submission. Uploaded files keep their original content; generated presentations use the saved slides.</p></div>
    <button type="button" disabled={busy} onClick={() => void download()}>
      <i className={busy ? 'ri-loader-4-line' : 'ri-download-2-line'} aria-hidden="true" /> {busy ? 'Downloading presentation…' : 'Download presentation'}
    </button>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {saved && <p role="status">Presentation download started.</p>}
  </section>;
}
