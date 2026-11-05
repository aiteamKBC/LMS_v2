import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, X } from 'lucide-react';
import { AssignmentPdfPreview } from '@/pages/learner/monthly-submission/AssignmentPdfPreview';

export default function EvidencePdfDialog({ open, url, kind, busy, error, onRetry, onClose, onDownload }: {
  open: boolean; url: string; kind: 'transcript' | 'analysis'; busy: boolean; error: string;
  onRetry: () => void; onClose: () => void; onDownload: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const title = kind === 'transcript' ? 'Transcript PDF' : 'AI analysis PDF';
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow, ownsScrollLock = overflow !== 'hidden';
    if (ownsScrollLock) document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const containFocus = (event: FocusEvent) => {
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) closeButton.current?.focus();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', containFocus);
      if (ownsScrollLock) document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  return createPortal(<div hidden={!open} className={`fixed inset-0 z-[100] ${open ? 'flex' : 'hidden'} items-center justify-center bg-black/60 p-2 sm:p-6`}
    onMouseDown={event => { if (event.target === event.currentTarget) { event.stopPropagation(); onClose(); } }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-white text-foreground-900 shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-background-200 px-4 py-3 sm:px-6">
        <h2 id={titleId} className="inline-flex items-center gap-2 text-base font-bold"><FileText size={18} />{title}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDownload} disabled={busy || !url} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"><Download size={14} />Download PDF</button>
          <button ref={closeButton} type="button" aria-label="Close PDF preview" onClick={onClose} className="rounded-lg p-2 text-foreground-600 hover:bg-background-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"><X size={18} /></button>
        </div>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-5">
        {url ? <AssignmentPdfPreview url={url} scrollableZoom filename={kind === 'transcript' ? 'Coaching session - full transcript.pdf' : 'Coaching session - saved AI report.pdf'}
          label={kind === 'transcript' ? 'Transcript PDF preview' : 'AI analysis PDF preview'} /> :
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 rounded-xl bg-background-50 p-6 text-center">
            {error ? <div role="alert" className="space-y-3 text-sm text-amber-900"><p>{error}</p>
              <button type="button" onClick={onRetry} className="rounded-lg border border-primary-200 bg-white px-4 py-2 font-semibold text-primary-700">Retry PDF</button></div> :
              <><div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-primary-100 border-t-primary-600 motion-reduce:animate-none" />
                <p role="status" className="text-sm text-foreground-600">Preparing PDF…</p></>}
          </div>}
      </div>
    </div>
  </div>, document.body);
}
