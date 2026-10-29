import { useEffect, useRef, useState } from 'react';
import { Download, Eye } from 'lucide-react';
import { attachedQualityPdf } from '@/api/coachingQualityReviews';
import { AssignmentPdfPreview } from '@/pages/learner/monthly-submission/AssignmentPdfPreview';
import QualityModal from './QualityModal';
const button = 'inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-50';

export default function QualityPdfActions({ reviewId, version, onPreviewChange }: { reviewId: string; version: number; onPreviewChange?: (open: boolean) => void }) {
  const [url, setUrl] = useState(''), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const resource = useRef(''), active = useRef(true), pending = useRef(false), changed = useRef(onPreviewChange); changed.current = onPreviewChange;
  useEffect(() => { active.current = true; return () => { active.current = false; if (resource.current) URL.revokeObjectURL(resource.current); changed.current?.(false); }; }, []);
  const close = () => { setOpen(false); changed.current?.(false); };
  const prepare = async (download: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    if (!download) { setOpen(true); changed.current?.(true); }
    try {
      let value = resource.current;
      if (!value) { const blob = await attachedQualityPdf(reviewId, version); if (!active.current) return; value = URL.createObjectURL(blob); resource.current = value; setUrl(value); }
      if (download) { const link = document.createElement('a'); link.href = value; link.download = `quality-check-v${version}.pdf`; document.body.append(link); link.click(); link.remove(); }
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : 'The saved quality PDF could not be loaded.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <><p className="text-[10px] text-foreground-500">Saved PDF - version {version}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void prepare(false)}><Eye size={13} />Preview PDF</button><button className={`${button} bg-primary-600 text-white`} disabled={busy} onClick={() => void prepare(true)}><Download size={13} />Download PDF</button></div>
    {error && !open && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    {open && <QualityModal title="Quality check PDF" top onClose={close} footer={<button className={button} disabled={!url || busy} onClick={() => void prepare(true)}><Download size={13} />Download PDF</button>}>
      {url ? <AssignmentPdfPreview scrollableZoom url={url} filename={`Quality check - version ${version}.pdf`} label="Quality check PDF preview" /> : error ? <div role="alert">{error}<button className={`${button} ml-3`} onClick={() => void prepare(false)}>Retry PDF</button></div> : <p role="status">Loading saved quality PDF…</p>}
    </QualityModal>}
  </>;
}
