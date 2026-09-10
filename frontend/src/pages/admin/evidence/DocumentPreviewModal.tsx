import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchEvidenceDocument, fetchEvidenceText, type EvidenceDocumentUrl } from '@/api/adminEvidence';
import { ReportFormModal } from './ReportFormModal';

type PreviewMode = 'native' | 'office' | 'text' | 'unsupported';

function extensionOf(document: EvidenceDocumentUrl): string {
  const sourcePath = document.url.split('?', 1)[0];
  const candidate = sourcePath.split('/').at(-1) || document.name;
  return candidate.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ||
    document.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
}

function previewModeOf(document: EvidenceDocumentUrl): PreviewMode {
  const extension = extensionOf(document);
  const contentType = (document.contentType || '').toLowerCase();
  if (extension === 'txt' || contentType.startsWith('text/plain')) return 'text';
  if (['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension) ||
      contentType === 'application/pdf' || contentType.startsWith('image/')) return 'native';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension) ||
      /msword|ms-excel|ms-powerpoint|officedocument/.test(contentType)) return 'office';
  return 'unsupported';
}

export function DocumentPreviewModal({
  path, title, learnerId, evidenceId, onClose, onReportBuilt,
}: {
  path: string;
  title: string;
  learnerId?: number;
  evidenceId?: number;
  onClose: () => void;
  onReportBuilt?: () => void;
}) {
  const [document, setDocument] = useState<EvidenceDocumentUrl | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buildingReport, setBuildingReport] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setText(null);
    try {
      const next = await fetchEvidenceDocument(path);
      setDocument(next);
      if (previewModeOf(next) === 'text' && next.textPreviewPath) {
        const textResult = await fetchEvidenceText(next.textPreviewPath);
        setText(textResult.text);
      }
    } catch (caught) {
      setDocument(null);
      setError(caught instanceof Error ? caught.message : 'Could not prepare this document.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    if (!document?.expiresAt) return;
    const expires = new Date(document.expiresAt).getTime();
    const delay = Math.max(1_000, expires - Date.now() - 30_000);
    refreshTimer.current = window.setTimeout(() => { void load(); }, delay);
    return () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [document?.expiresAt, load]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !buildingReport) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [buildingReport, onClose]);

  const mode = document ? previewModeOf(document) : null;
  const canBuildReport = path.includes('part=report') && learnerId !== undefined && evidenceId !== undefined;
  const embedUrl = useMemo(() => {
    if (!document) return '';
    return mode === 'office'
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(document.url)}`
      : document.url;
  }, [document, mode]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 md:p-6" role="dialog" aria-modal="true" aria-labelledby="evidence-preview-title">
      <div className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[var(--kbc-surface)] shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-200/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Document preview</p>
            <h2 id="evidence-preview-title" className="truncate text-sm font-semibold text-foreground-900">
              {document?.name || title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {document && (
              <>
                {canBuildReport && (
                  <button type="button" onClick={() => setBuildingReport(true)} className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[12px] font-semibold text-primary-700 hover:bg-primary-100">
                    <AppIcon className="ri-file-add-line mr-1" />Build
                  </button>
                )}
                <a href={document.downloadUrl} className="rounded-lg border border-foreground-200 px-3 py-2 text-[12px] font-semibold text-foreground-700 hover:bg-background-100" download>
                  <AppIcon className="ri-download-line mr-1" />Download
                </a>
                <a href={document.url} target="_blank" rel="noreferrer" className="rounded-lg border border-foreground-200 px-3 py-2 text-[12px] font-semibold text-foreground-700 hover:bg-background-100">
                  <AppIcon className="ri-external-link-line mr-1" />Open in new tab
                </a>
              </>
            )}
            <button type="button" onClick={onClose} className="rounded-lg bg-foreground-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-foreground-700">Close</button>
          </div>
        </header>

        <div className="min-h-0 flex-1 bg-background-100/60">
          {loading ? (
            <div className="flex h-full items-center justify-center" role="status">
              <p className="text-sm text-foreground-500"><AppIcon className="ri-loader-4-line mr-2 animate-spin" />Preparing document preview…</p>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" role="alert">
              <AppIcon className="ri-error-warning-line text-3xl text-red-500" />
              <p className="text-sm font-semibold text-red-800">{error}</p>
              <button type="button" onClick={() => void load()} className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white">Try again</button>
            </div>
          ) : mode === 'text' ? (
            <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-white p-6 text-sm text-foreground-800">{text || 'This text document is empty.'}</pre>
          ) : mode === 'unsupported' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <AppIcon className="ri-file-unknow-line text-4xl text-foreground-300" />
              <p className="text-sm font-semibold text-foreground-800">This file type cannot be previewed inside the system.</p>
              <p className="text-xs text-foreground-500">Use Download or Open in new tab.</p>
            </div>
          ) : document ? (
            <iframe src={embedUrl} title={document.name} className="h-full w-full border-0 bg-white" onError={() => setError('The preview link expired or the document could not be loaded.')} />
          ) : null}
        </div>
      </div>
      {buildingReport && learnerId !== undefined && evidenceId !== undefined && (
        <ReportFormModal learnerId={learnerId} evidenceId={evidenceId} onClose={() => setBuildingReport(false)} onSaved={() => { void load(); onReportBuilt?.(); }} />
      )}
    </div>
  );
}
