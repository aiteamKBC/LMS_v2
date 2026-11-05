import { useEffect, useRef, useState } from 'react';
import { Download, Eye } from 'lucide-react';
import { loadCoachingPdf } from '@/api/coachingRecordings';
import EvidencePdfDialog from './EvidencePdfDialog';

export default function SavedEvidencePdf({ eventKey, reference, kind, analysisId, onPreviewChange }: {
  eventKey: string; reference?: string; kind: 'transcript' | 'analysis'; analysisId?: string;
  onPreviewChange?: (open: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const objectUrl = useRef('');
  const callback = useRef(onPreviewChange);
  callback.current = onPreviewChange;
  useEffect(() => () => {
    request.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    callback.current?.(false);
  }, []);
  const prepare = async () => {
    if (objectUrl.current) return objectUrl.current;
    if (request.current) return '';
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const blob = await loadCoachingPdf(eventKey, kind, reference, analysisId, controller.signal);
      if (controller.signal.aborted) return '';
      const value = URL.createObjectURL(blob);
      objectUrl.current = value; setUrl(value);
      return value;
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The PDF could not be prepared.');
      return '';
    } finally {
      if (!controller.signal.aborted) { setBusy(false); request.current = null; }
    }
  };
  const preview = async () => {
    if (open) { setOpen(false); callback.current?.(false); return; }
    setOpen(true); callback.current?.(true);
    await prepare();
  };
  const download = async () => {
    const value = await prepare();
    if (!value) return;
    const anchor = document.createElement('a');
    anchor.href = value; anchor.download = `coaching-${kind}.pdf`;
    document.body.append(anchor); anchor.click(); anchor.remove();
  };
  const button = 'inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-50';
  return <div aria-label={kind === 'transcript' ? 'Transcript PDF' : 'AI analysis PDF'}>
    <div hidden={open} className={open ? 'hidden' : 'flex flex-wrap gap-2'}>
      <button type="button" disabled={busy} className={button} aria-expanded={open} onClick={() => void preview()}>
        <Eye size={13} />Preview PDF</button>
      <button type="button" disabled={busy} className={`${button} bg-primary-600 text-white`} onClick={() => void download()}><Download size={13} />Download PDF</button>
    </div>
    {busy && !open && <p role="status" className="mt-2 text-xs text-foreground-600">Preparing PDF…</p>}
    {error && !open && <p role="alert" className="mt-2 text-xs text-amber-900">{error} Use Preview PDF or Download PDF to retry.</p>}
    {(open || url) && <EvidencePdfDialog open={open} url={url} kind={kind} busy={busy} error={error} onRetry={() => void prepare()}
      onClose={() => { setOpen(false); callback.current?.(false); }} onDownload={() => void download()} />}
  </div>;
}
